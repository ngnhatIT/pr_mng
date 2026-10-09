import { Request, Response, NextFunction } from 'express';
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
      res.status(429).json({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.' });
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
  /** Hàm sinh key — mặc định theo IP. */
  keyFn?: (req: Request) => string;
}

/**
 * IP client dùng cho rate limit.
 * Mặc định key theo req.socket.remoteAddress. CHỈ tin X-Forwarded-For khi
 * env TRUST_PROXY=true (chạy sau reverse proxy đáng tin) — chống bypass H6.
 */
function trustedClientIp(req: Request): string {
  if (env.TRUST_PROXY) {
    const xff = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || req.ip || 'unknown';
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
  const keyFn = opts.keyFn ?? trustedClientIp;
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

/** 300 requests / 15 phút / IP — áp dụng global cho /api/v1. */
export const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.',
});

/** 60 requests / 15 phút / IP — cho các thao tác ghi (POST/PUT/PATCH/DELETE). */
export const writeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Bạn thao tác ghi quá nhanh, vui lòng thử lại sau ít phút.',
});

/** 200 requests / 15 phút / IP — cho cổng phụ huynh (mobile). */
export const parentRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
});

/**
 * 5 requests / 15 phút / IP — cho thao tác tốn tiền thật (gửi Zalo ZNS, sweep nhắc nợ).
 * Chống đốt tiền khi token staff bị lộ.
 */
export const costlyOpRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Thao tác này bị giới hạn 5 lần / 15 phút để tránh phát sinh chi phí. Vui lòng thử lại sau.',
});

/** 100 requests / 15 phút / IP — cho phục vụ file (chống cạn băng thông). */
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
    res.status(429).json({ error: 'Thử quá nhiều lần, vui lòng đợi một phút rồi thử lại' });
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
