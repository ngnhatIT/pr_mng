import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest, AuthUser } from './auth';
import { env } from '../config/env';

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

export function publicRateLimit(maxPerWindow = 30, windowMs = 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = trustedClientIp(req);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now > b.reset) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    if (b.count > maxPerWindow) {
      res.status(429).json({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
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
    // Giữ đồng bộ với JWT_VERIFY_OPTS trong middleware/auth.ts
    return jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ['HS256'] }) as AuthUser;
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
  const { windowMs, max } = opts;
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

/** 60 requests / 15 phút / tài khoản (IP nếu chưa đăng nhập) — cho các thao tác ghi (POST/PUT/PATCH/DELETE). */
export const writeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
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

/* ------------------------- Login rate limit ------------------------- */

const LOGIN_WINDOW_MS = env.LOGIN_RATE_WINDOW_MS;
const LOGIN_MAX = env.LOGIN_RATE_LIMIT;
// key: `${ip}:${path}` → các timestamp request trong window hiện tại
const loginHits = new Map<string, number[]>();

/**
 * Chống brute-force cho login/register: tối đa 10 request / 60 giây
 * cho mỗi IP trên mỗi endpoint. Quá giới hạn → 429.
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = trustedClientIp(req);
  // Normalize path: /api/auth/login và /api/v1/auth/login dùng chung key (chống bypass qua legacy alias)
  const normalizedPath = req.path.replace(/^\/api\/v1\//, '/api/');
  const key = `${ip}:${normalizedPath}`;
  const prev = loginHits.get(key) || [];
  const recent = prev.filter((t) => now - t < LOGIN_WINDOW_MS);

  if (recent.length >= LOGIN_MAX) {
    res.status(429).json({ error: 'Thử quá nhiều lần, vui lòng đợi một phút rồi thử lại', code: 'RATE_LIMITED' });
    return;
  }

  recent.push(now);
  loginHits.set(key, recent);

  // Dọn dẹp định kỳ để không rò rỉ bộ nhớ
  if (loginHits.size > 1000) {
    for (const [k, times] of loginHits) {
      const fresh = times.filter((t) => now - t < LOGIN_WINDOW_MS);
      if (fresh.length === 0) loginHits.delete(k);
      else loginHits.set(k, fresh);
    }
  }

  next();
}
