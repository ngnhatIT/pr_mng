import { Request, Response, NextFunction } from 'express';
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

/** Đọc refresh token từ cookie (dùng ở refresh/logout/change-password). */
export function getRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return undefined;
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
