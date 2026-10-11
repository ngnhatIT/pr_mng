import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest, AuthUser } from './auth';
import { JWT_VERIFY_OPTS } from './auth';
import { env } from '../config/env';
import { normalizePhone } from '../services/zalo';
import { deviceCookieId } from './cookieAuth';

/**
 * Rate-limit đơn giản theo IP cho các API công khai (in-memory).
 * Mỗi IP được tối đa `maxPerWindow` request trong mỗi `windowMs`.
 */
interface Bucket {
  count: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();

// Dọn dẹp bucket hết hạn mỗi 5 phút để không phình bộ nhớ
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now > b.reset) buckets.delete(k);
    }
  },
  5 * 60 * 1000
).unref();

let publicNs = 0;

export function publicRateLimit(maxPerWindow = 30, windowMs = 60 * 1000) {
  // CORR-3: mỗi lần gọi (mỗi route) có namespace riêng — landing gọi 4 GET + form + client-errors
  // không còn chung 1 bộ đếm/IP (khách sau CGNAT nhà mạng bị 429 ngay lúc tải trang).
  const ns = ++publicNs;
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = `${ns}:${trustedClientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now > b.reset) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    // B2: chia quota theo số worker (mỗi worker có Map riêng)
    if (b.count > effectiveMax(maxPerWindow)) {
      res
        .status(429)
        .json({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}

/**
 * B2: Số worker PM2 cluster (mặc định 1). Vì mỗi worker giữ Map rate-limit
 * riêng, max cấu hình phải chia cho số worker để tổng toàn cụm không vượt max.
 * Đọc live từ env để test có thể đổi mà không cần restart module.
 */
export function effectiveMax(max: number): number {
  const d = Math.max(1, Math.floor(env.RATE_LIMIT_DIVISOR));
  return Math.max(1, Math.floor(max / d));
}

/* ------------------------- Rate limit toàn diện ------------------------- */

export interface RateLimitOptions {
  /** Cửa sổ tính bằng ms. */
  windowMs: number;
  /** Số request tối đa trong mỗi cửa sổ. */
  max: number;
  /** Thông điệp khi bị chặn (tiếng Việt). */
  message?: string;
  /** Hàm sinh key — mặc định: user đã auth → theo tài khoản, còn lại theo IP. */
  keyFn?: (req: Request) => string;
}

/**
 * IP client dùng cho rate limit.
 * Mặc định key theo req.socket.remoteAddress. CHỈ tin X-Forwarded-For khi
 * env TRUST_PROXY=true (chạy sau reverse proxy đáng tin) — chống bypass H6.
 */
function trustedClientIp(req: Request): string {
  // Dùng req.ip (Express trust proxy đã parse XFF đúng: lấy IP phải nhất của proxy đáng tin)
  // Không lấy XFF trái nhất vì client tự gửi được (spoof).
  if (env.TRUST_PROXY) {
    if (req.ip) return req.ip;
  }
  return req.socket.remoteAddress || req.ip || 'unknown';
}

/**
 * Verify Bearer token nếu có, không throw. Cần vì v1.use(apiRateLimit) mount TRƯỚC
 * requireAuth của từng route nên req.user chưa được gán khi limiter chạy.
 * Token giả/hết hạn → undefined → fallback IP (attacker không tự chọn được bucket).
 */
function tokenUser(req: Request): AuthUser | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  try {
    return jwt.verify(header.slice(7), env.JWT_SECRET, JWT_VERIFY_OPTS) as AuthUser;
  } catch {
    return undefined;
  }
}

/**
 * Key mặc định: đã đăng nhập (req.user hoặc Bearer token hợp lệ) → `u:<kind>:<id>`
 * (namespace kind vì parent/staff có thể trùng id số); anonymous → theo IP như cũ.
 * Văn phòng nhiều staff chung 1 IP NAT không còn chia quota 300 req/15ph.
 */
function defaultRateLimitKey(req: Request): string {
  const user = (req as AuthRequest).user ?? tokenUser(req);
  if (user?.id != null) return `u:${user.kind ?? 'x'}:${user.id}`;
  return trustedClientIp(req);
}

/**
 * Factory tạo rate limiter dùng sliding window (chính xác hơn fixed counter).
 * - Headers chuẩn: X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset (epoch giây)
 * - Khi bị chặn: 429 + header Retry-After + message tiếng Việt
 * - In-memory, dọn dẹp định kỳ để không rò rỉ bộ nhớ
 */
export function createRateLimit(opts: RateLimitOptions) {
  const { windowMs } = opts;
  // B2: max hiệu dụng trên mỗi worker = max cấu hình / số worker
  const max = effectiveMax(opts.max);
  const message = opts.message ?? 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
  const keyFn = opts.keyFn ?? defaultRateLimitKey;
  // key -> timestamps của các request trong cửa sổ (sliding window)
  const hits = new Map<string, number[]>();

  setInterval(
    () => {
      const now = Date.now();
      for (const [k, times] of hits) {
        const fresh = times.filter((t) => now - t < windowMs);
        if (fresh.length === 0) hits.delete(k);
        else hits.set(k, fresh);
      }
    },
    Math.min(windowMs, 5 * 60 * 1000)
  ).unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = keyFn(req);
    const prev = hits.get(key) || [];
    const recent = prev.filter((t) => now - t < windowMs);

    const resetEpoch = Math.ceil((recent.length > 0 ? recent[0] + windowMs : now + windowMs) / 1000);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Reset', String(resetEpoch));

    if (recent.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message, code: 'RATE_LIMITED', retry_after: retryAfter });
      return;
    }

    res.setHeader('X-RateLimit-Remaining', String(max - recent.length - 1));
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

/** 300 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — áp dụng global cho /api/v1. */
export const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.',
});

/**
 * 600 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — trần chung cho thao tác ghi
 * (POST/PUT/PATCH/DELETE). Chấm bài/điểm danh là 1 request mỗi học viên (2 lớp x 35 HV x 2 câu
 * tự luận = 140 POST) nên trần 60 cũ chặn nghiệp vụ thường ngày. Endpoint nhạy cảm có limiter
 * riêng chặt hơn: login/register/forgot (loginRateLimit), public, costlyOp, upload.
 */
export const writeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Bạn thao tác ghi quá nhanh, vui lòng thử lại sau ít phút.',
});

/** 200 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — cho cổng phụ huynh (mobile). */
export const parentRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
});

/**
 * 5 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — cho thao tác tốn tiền thật
 * (gửi Zalo ZNS, sweep nhắc nợ). Chống đốt tiền khi token staff bị lộ.
 */
export const costlyOpRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Thao tác này bị giới hạn 5 lần / 15 phút để tránh phát sinh chi phí. Vui lòng thử lại sau.',
});

/** 100 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — cho phục vụ file (chống cạn băng thông). */
export const fileServeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Bạn tải file quá nhanh, vui lòng thử lại sau ít phút.',
});

/** 30 requests / 15 phút / tài khoản — giáo viên tải file đính kèm (ghi đĩa, tốn I/O hơn GET). */
export const uploadRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Bạn tải file lên quá nhanh, vui lòng thử lại sau ít phút.',
});

/**
 * C-3: callback VNPay (IPN/return) — VNPay gửi IPN của MỌI trung tâm từ vài IP, không được dùng chung
 * trần 300/15ph/IP của apiRateLimit (mùa đóng học phí bị 429 -> phụ huynh thấy "chờ" cả giờ).
 * Chữ ký HMAC mới là lớp bảo vệ chính; limiter này chỉ chặn spam thô.
 */
export const vnpayCallbackRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  keyFn: (req) => `vnp:${trustedClientIp(req)}`,
});

/* ------------------------- Login rate limit ------------------------- */

// key: `${ip}:${path}` → các timestamp request trong window hiện tại
const loginHits = new Map<string, number[]>();
// D5: key `login:<username|phone>` → timestamp theo tài khoản (lớp 2)
const loginAccountHits = new Map<string, number[]>();

function recentHits(hits: Map<string, number[]>, key: string, windowMs: number, now: number): number[] {
  return (hits.get(key) || []).filter((t) => now - t < windowMs);
}

/** Ghi 1 hit vào bucket sliding-window; trả timestamp đã ghi, null = đã vượt max (không ghi thêm). */
function takeLoginSlot(
  hits: Map<string, number[]>,
  key: string,
  windowMs: number,
  max: number
): number | null {
  const now = Date.now();
  const recent = recentHits(hits, key, windowMs, now);
  if (recent.length >= max) return null;
  recent.push(now);
  hits.set(key, recent);
  // Dọn dẹp định kỳ để không rò rỉ bộ nhớ
  if (hits.size > 1000) {
    for (const [k, times] of hits) {
      const fresh = times.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(k);
      else hits.set(k, fresh);
    }
  }
  return now;
}

function tooManyAttempts(res: Response): void {
  res
    .status(429)
    .json({ error: 'Thử quá nhiều lần, vui lòng đợi một phút rồi thử lại', code: 'RATE_LIMITED' });
}

/**
 * Key tài khoản cho lớp 2: SĐT chuẩn hóa bằng đúng normalizePhone của service
 * ('0901…', '+84901…', '84901…' là 1 tài khoản -> 1 bucket); username lowercase + trim.
 */
export function loginAccountKey(body: unknown): string {
  const b = body as { username?: unknown; phone?: unknown } | undefined;
  if (typeof b?.phone === 'string' && b.phone.trim())
    return normalizePhone(b.phone) ?? b.phone.trim().toLowerCase();
  if (typeof b?.username === 'string') return b.username.trim().toLowerCase();
  return '';
}

/** Loại tài khoản theo body: phone -> phụ huynh, username -> nhân sự (khớp setDeviceCookie ở login). */
export function loginAccountKind(body: unknown): 'staff' | 'parent' {
  const b = body as { phone?: unknown } | undefined;
  return typeof b?.phone === 'string' && b.phone.trim() ? 'parent' : 'staff';
}

/**
 * Chống brute-force cho login/register/forgot (2 lớp):
 * - Lớp 1: tối đa 10 request / 60 giây cho mỗi IP trên mỗi endpoint
 *   (chia cho số worker qua RATE_LIMIT_DIVISOR — B2).
 * - D5 — lớp 2: 20 lần / 15 phút cho mỗi tài khoản, chống dò mật khẩu 1 user từ nhiều IP.
 *   Đăng nhập THÀNH CÔNG được hoàn lại hit (chính chủ không tự tiêu quota); forgot/register
 *   đếm mọi lần.
 * - S-4: thiết bị có device cookie hợp lệ của tài khoản (đã từng đăng nhập thành công) dùng
 *   bucket RIÊNG `login-dev:…:<nonce>` (mỗi thiết bị 1 bucket) — kẻ tấn công sai liên tục chỉ khóa bucket ẩn danh, không khóa chính chủ.
 * Quá giới hạn → 429.
 * ponytail: bucket in-memory theo worker (RATE_LIMIT_DIVISOR) — chuyển Redis khi scale nhiều máy.
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = trustedClientIp(req);
  // Normalize path: /api/auth/login và /api/v1/auth/login dùng chung key (chống bypass qua legacy alias)
  const normalizedPath = req.path.replace(/^\/api\/v1\//, '/api/');
  if (
    takeLoginSlot(
      loginHits,
      `${ip}:${normalizedPath}`,
      env.LOGIN_RATE_WINDOW_MS,
      effectiveMax(env.LOGIN_RATE_LIMIT)
    ) === null
  ) {
    tooManyAttempts(res);
    return;
  }
  const loginName = loginAccountKey(req.body);
  if (loginName) {
    const kind = loginAccountKind(req.body);
    // J-A6: bucket riêng TỪNG thiết bị (nonce) — cookie lộ không rút cạn được bucket thiết bị khác
    const dev = deviceCookieId(req, kind, loginName);
    const key = dev ? `login-dev:${kind}:${loginName}:${dev}` : `login:${loginName}`;
    // Ghi hit TRƯỚC khi xử lý (burst song song không lọt qua), hoàn lại nếu đăng nhập thành công
    const at = takeLoginSlot(
      loginAccountHits,
      key,
      env.LOGIN_ACCOUNT_WINDOW_MS,
      effectiveMax(env.LOGIN_ACCOUNT_RATE_LIMIT)
    );
    if (at === null) {
      tooManyAttempts(res);
      return;
    }
    if (/\/login$/.test(req.path)) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        const times = loginAccountHits.get(key);
        const i = times?.indexOf(at) ?? -1;
        if (i >= 0) times!.splice(i, 1);
      });
    }
  }
  next();
}

/** Đăng ký phụ huynh: 5 tài khoản / giờ / IP (luôn theo IP — token hợp lệ không đổi được bucket). */
export const registerRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Bạn đăng ký quá nhiều tài khoản, vui lòng thử lại sau.',
  keyFn: (req) => `reg:${trustedClientIp(req)}`,
});
