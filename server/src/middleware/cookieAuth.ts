import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Refresh token qua HttpOnly cookie (D4) thay vì localStorage:
 * JS phía client không đọc được -> chống đánh cắp qua XSS.
 * Không dùng cookie-parser (thêm dependency cho 1 cookie là thừa):
 * parse thủ công cookie duy nhất 'refresh_token'.
 */

export const REFRESH_COOKIE = 'refresh_token';

function cookieOpts(path: string) {
  return {
    httpOnly: true,
    secure: env.IS_PROD, // DEV http://localhost vẫn gửi được cookie
    sameSite: 'strict' as const, // chặn CSRF cross-site ở tầng browser
    path, // tách /api/v1/auth và /api/v1/parent để 2 phiên không đè nhau
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 3600 * 1000,
  };
}

/** Ghi refresh token vào HttpOnly cookie (dùng ở login/refresh). */
export function setRefreshCookie(res: Response, rawToken: string, path: string): void {
  res.cookie(REFRESH_COOKIE, rawToken, cookieOpts(path));
}

/** Xóa refresh cookie (dùng ở logout). */
export function clearRefreshCookie(res: Response, path: string): void {
  res.clearCookie(REFRESH_COOKIE, cookieOpts(path));
}

/** Đọc 1 cookie theo tên (parse thủ công, không cần cookie-parser). */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      // CORR-4: cookie méo (%E0...) làm decodeURIComponent ném URIError -> 500; coi như không có cookie
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Đọc refresh token từ cookie (dùng ở refresh/logout/change-password). */
export function getRefreshCookie(req: Request): string | undefined {
  return getCookie(req, REFRESH_COOKIE);
}

/* ---------------- S-4: device cookie chống khóa tài khoản có chủ đích ---------------- */

/**
 * OWASP "device cookies": thiết bị đã đăng nhập thành công tài khoản X giữ cookie
 * `nonce.exp.HMAC(JWT_SECRET, kind:X:nonce:exp)`. loginRateLimit cho thiết bị đó bucket RIÊNG theo nonce —
 * kẻ tấn công (không có cookie) chỉ làm cạn bucket ẩn danh, chính chủ vẫn đăng nhập được.
 * J-A6: mỗi lần đăng nhập thành công phát cookie mới (nonce ngẫu nhiên, hết hạn sau DEVICE_TTL_MS) —
 * cookie bị lộ / của người cũ chỉ là 1 bucket riêng, tự chết khi hết hạn, không rút cạn được bucket
 * của các thiết bị khác. Stateless, không migration. Cookie chỉ chọn bucket rate-limit, KHÔNG phải credential.
 */
export const DEVICE_COOKIE = 'ld';
const DEVICE_TTL_MS = 90 * 24 * 3600 * 1000;

function deviceMac(kind: 'staff' | 'parent', accountKey: string, nonce: string, exp: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`ld:${kind}:${accountKey}:${nonce}:${exp}`)
    .digest('base64url');
}

/** Cookie thiết bị mới (nonce ngẫu nhiên). `now` để test hết hạn. */
export function deviceToken(kind: 'staff' | 'parent', accountKey: string, now = Date.now()): string {
  const nonce = crypto.randomBytes(12).toString('base64url');
  const exp = String(now + DEVICE_TTL_MS);
  return `${nonce}.${exp}.${deviceMac(kind, accountKey, nonce, exp)}`;
}

export function setDeviceCookie(
  res: Response,
  kind: 'staff' | 'parent',
  accountKey: string,
  path: string
): void {
  if (!accountKey) return;
  res.cookie(DEVICE_COOKIE, deviceToken(kind, accountKey), {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: 'strict',
    path,
    maxAge: DEVICE_TTL_MS,
  });
}

/** Nonce của device cookie hợp lệ, chưa hết hạn cho tài khoản này (so sánh constant-time); null nếu không có. */
export function deviceCookieId(req: Request, kind: 'staff' | 'parent', accountKey: string): string | null {
  const got = getCookie(req, DEVICE_COOKIE);
  if (!got || !accountKey) return null;
  const parts = got.split('.');
  if (parts.length !== 3) return null;
  const [nonce, exp, mac] = parts;
  if (!nonce || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(deviceMac(kind, accountKey, nonce, exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? nonce : null;
}

/**
 * Anti-CSRF cho /refresh và /logout (cookie tự gửi theo request nên cần lớp này
 * dù đã có sameSite=strict).
 * Chấp nhận request khi Origin (hoặc origin rút từ Referer) nằm trong allowlist
 * CORS_ORIGIN. Không có cả 2 header (curl, mobile, server-to-server) -> cho qua.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  let candidate: string | undefined = origin;
  if (!candidate) {
    const referer = req.get('referer');
    if (referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = undefined;
      }
    }
  }
  if (candidate) {
    const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, ''));
    if (!allowed.includes(candidate)) {
      res.status(403).json({ error: 'Origin không được phép', code: 'FORBIDDEN' });
      return;
    }
  }
  next();
}
