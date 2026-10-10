import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { AuthUser, DUMMY_PASSWORD_HASH, invalidateTokenCheck, requireAuth, type AuthRequest } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../shared/http';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllForOwner, revokeAllForOwnerExcept } from './refresh.service';
import { audit } from '../../shared/audit';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../../shared/password';
import { logger } from '../../shared/logger';
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
  requireSameOrigin,
} from '../../middleware/cookieAuth';

/** Path cookie refresh cho staff: tách khỏi parent để 2 phiên không đè nhau. */
const COOKIE_PATH = '/api/v1/auth';

const log = logger.scope('auth');

const router = Router();

function reqMeta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu', code: 'BAD_REQUEST' });
      return;
    }
    const user = (await db.prepare('SELECT * FROM users WHERE username = ?').get(username)) as
      | {
          id: number;
          username: string;
          password_hash: string;
          role: string;
          name: string;
          center_id: number | null;
          teacher_id: number | null;
          token_version: number;
          is_active: boolean;
        }
      | undefined;
    const passwordOk = user
      ? bcrypt.compareSync(password, user.password_hash)
      : bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      // Log failed login để phát hiện brute-force (không log password)
      log.warn('Đăng nhập thất bại', { username, ip: reqMeta(req).ip });
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng', code: 'UNAUTHORIZED' });
      return;
    }
    // D2: từ chối tài khoản đã bị khóa
    if (!user.is_active) {
      log.warn('Đăng nhập bị từ chối: tài khoản đã khóa', { username, ip: reqMeta(req).ip });
      res.status(403).json({ error: 'Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên', code: 'ACCOUNT_LOCKED' });
      return;
    }
    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      kind: 'staff',
      center_id: user.center_id ?? null,
      teacher_id: user.teacher_id ?? null,
      tv: user.token_version, // D2: nhúng token version để thu hồi access token ngay khi đổi pass/khóa TK
    };
    const pair = await issueTokenPair(payload, reqMeta(req));
    // Audit login thành công (forensics: ai đăng nhập lúc nào, từ IP nào)
    await audit({
      centerId: user.center_id ?? null,
      actor: { id: user.id, name: user.name, role: user.role, ip: reqMeta(req).ip },
      action: 'login',
      entity: 'users',
      entityId: user.id,
      summary: `${user.name} đăng nhập`,
    });
    // D4: refresh token chỉ đi qua HttpOnly cookie, KHÔNG trả trong body nữa
    setRefreshCookie(res, pair.refresh_token, COOKIE_PATH);
    res.json({ token: pair.token, expires_in: pair.expires_in, user: payload });
  })
);

/** Đổi refresh token (đọc từ HttpOnly cookie) lấy cặp token mới (rotation). */
router.post(
  '/refresh',
  loginRateLimit,
  requireSameOrigin, // D4: cookie tự gửi theo request -> cần chống CSRF
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = getRefreshCookie(req);
    if (!refreshToken) {
      res.status(400).json({ error: 'Thiếu refresh token', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const pair = await rotateRefreshToken(refreshToken, reqMeta(req));
    setRefreshCookie(res, pair.refresh_token, COOKIE_PATH);
    res.json({ token: pair.token, expires_in: pair.expires_in });
  })
);

/** Đăng xuất: thu hồi refresh token trong cookie rồi xóa cookie. */
router.post(
  '/logout',
  requireSameOrigin, // D4: chống CSRF
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = getRefreshCookie(req);
    if (refreshToken) await revokeRefreshToken(refreshToken);
    clearRefreshCookie(res, COOKIE_PATH);
    res.json({ ok: true });
  })
);

/** Đăng xuất mọi thiết bị: thu hồi toàn bộ refresh token của user (khi nghi lộ credential). */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const u = req.user!;
    const isParent = u.kind === 'parent' || u.role === 'parent';
    await revokeAllForOwner(isParent ? 'parent' : 'staff', isParent ? (u.parent_id ?? u.id) : u.id);
    res.json({ ok: true });
  })
);

/** Đổi mật khẩu: yêu cầu mật khẩu cũ đúng + mật khẩu mới đủ mạnh. */
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const u = req.user!;
    if (u.kind === 'parent' || u.role === 'parent') {
      res.status(403).json({ error: 'Tài khoản phụ huynh dùng luồng riêng', code: 'NOT_STAFF' });
      return;
    }
    const { old_password, new_password } = (req.body ?? {}) as {
      old_password?: string;
      new_password?: string;
    };
    if (!old_password || !new_password || typeof new_password !== 'string') {
      res
        .status(400)
        .json({ error: 'Vui lòng nhập mật khẩu cũ và mật khẩu mới', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const row = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id)) as
      { password_hash: string } | undefined;
    if (!row || !bcrypt.compareSync(old_password, row.password_hash)) {
      res.status(400).json({ error: 'Mật khẩu cũ không đúng', code: 'WRONG_PASSWORD' });
      return;
    }
    if (old_password === new_password) {
      res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu cũ', code: 'SAME_PASSWORD' });
      return;
    }
    assertStrongPassword(new_password, 'Mật khẩu mới');
    const hash = bcrypt.hashSync(new_password, BCRYPT_ROUNDS);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
    // D2: tăng token_version → mọi access token cũ bị thu hồi ngay (kể cả session hiện tại;
    // client tự refresh lấy token mới khi gặp 401). Xóa cache để check có hiệu lực tức thì.
    await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(u.id);
    invalidateTokenCheck('staff', u.id);
    // Đổi mật khẩu = thu hồi mọi session khác (giữ session hiện tại, kẻ trộm bị đá ra)
    // D4: đọc refresh token từ cookie (fallback body cho client cũ trong đợt rolling deploy)
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    await revokeAllForOwnerExcept('staff', u.id, getRefreshCookie(req) ?? refresh_token);
    await audit({
      centerId: u.center_id ?? null,
      actor: { id: u.id, name: u.name, role: u.role },
      action: 'update',
      entity: 'users',
      entityId: u.id,
      summary: `${u.name} đổi mật khẩu`,
    });
    res.json({ ok: true });
  })
);

export default router;
