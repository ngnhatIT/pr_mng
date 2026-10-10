import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../db';
import { AuthUser, DUMMY_PASSWORD_HASH, invalidateTokenCheck, requireAuth, type AuthRequest } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { requirePermission } from '../authorization/authorization.middleware';
import { getPermissionScope } from '../authorization/authorization.service';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { paramId } from '../../shared/validate';
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

/* ---------------------------------------------------------------------------
 * Quên mật khẩu (P0 red-team).
 * Luồng trung thực cho demo (chưa có hạ tầng email/SMS): user gửi yêu cầu ->
 * admin xem danh sách (GET /reset-requests) và bấm "Đặt lại mật khẩu"
 * (POST /reset-requests/:id/process) để sinh mật khẩu tạm, rồi báo lại cho
 * user qua kênh ngoài hệ thống (gọi điện, gặp trực tiếp).
 * ------------------------------------------------------------------------- */

/** Gửi yêu cầu đặt lại mật khẩu (public, rate-limit). Luôn trả ok để không lộ tài khoản có tồn tại. */
router.post(
  '/forgot-password',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { kind, username, phone } = (req.body ?? {}) as {
      kind?: string;
      username?: string;
      phone?: string;
    };
    // kind=staff dùng username, kind=parent dùng phone — trùng key body với login
    // để loginRateLimit vẫn giới hạn theo tài khoản (D5).
    const identifier = kind === 'parent' ? String(phone ?? '').trim() : String(username ?? '').trim();
    if ((kind !== 'staff' && kind !== 'parent') || !identifier || identifier.length > 100) {
      res.status(400).json({ error: 'Thiếu thông tin yêu cầu đặt lại mật khẩu', code: 'VALIDATION_REQUIRED' });
      return;
    }
    await db.prepare('INSERT INTO reset_requests (identifier, kind) VALUES (?, ?)').run(identifier, kind);
    log.info('Yêu cầu đặt lại mật khẩu mới', { kind });
    res.json({ ok: true });
  })
);

/** Admin: danh sách yêu cầu đặt lại mật khẩu (chờ xử lý lên trước). */
router.get(
  '/reset-requests',
  requireAuth,
  requirePermission('users.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = await db
      .prepare(
        `SELECT id, identifier, kind, status, created_at FROM reset_requests
         ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`
      )
      .all();
    res.json({ data: rows });
  })
);

/** Admin: xử lý yêu cầu — sinh mật khẩu tạm, đá mọi session cũ của tài khoản, đánh dấu đã xử lý. */
router.post(
  '/reset-requests/:id/process',
  requireAuth,
  requirePermission('users.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const r = (await db.prepare('SELECT * FROM reset_requests WHERE id = ?').get(id)) as
      | { id: number; identifier: string; kind: string; status: string }
      | undefined;
    if (!r) throw AppError.notFound('Không tìm thấy yêu cầu');
    if (r.status !== 'pending') throw AppError.badRequest('Yêu cầu đã được xử lý', 'ALREADY_PROCESSED');

    // Tìm tài khoản theo định danh. Phía admin nên được phép biết tài khoản có tồn tại.
    const target =
      r.kind === 'staff'
        ? ((await db
            .prepare('SELECT id, center_id, name, role FROM users WHERE username = ?')
            .get(r.identifier)) as
            | { id: number; center_id: number | null; name: string; role: string }
            | undefined)
        : ((await db.prepare('SELECT id, center_id, name FROM parents WHERE phone = ?').get(r.identifier)) as
            | { id: number; center_id: number | null; name: string }
            | undefined);
    if (!target)
      throw AppError.notFound(
        `Không tìm thấy tài khoản ${r.kind === 'staff' ? 'nhân sự' : 'phụ huynh'} "${r.identifier}"`
      );

    const admin = req.user!;
    // Không cho admin reset superadmin (trừ chính superadmin) — chống leo thang quyền.
    if (r.kind === 'staff' && (target as { role?: string }).role === 'superadmin' && admin.role !== 'superadmin')
      throw AppError.forbidden('Chỉ superadmin được đặt lại mật khẩu của superadmin');
    // Không cho reset tài khoản ngoài trung tâm mình (trừ superadmin / scope all).
    if (admin.role !== 'superadmin' && target.center_id !== null && target.center_id !== admin.center_id) {
      const scope = await getPermissionScope(admin.id, 'users.update');
      if (scope !== 'all') throw AppError.forbidden('Yêu cầu thuộc trung tâm khác');
    }

    // Mật khẩu tạm ngẫu nhiên 12 ký tự — đủ mạnh theo assertStrongPassword (>= 8 ký tự, không phổ biến).
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const hash = bcrypt.hashSync(tempPassword, BCRYPT_ROUNDS);
    if (r.kind === 'staff') {
      await db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, target.id);
      invalidateTokenCheck('staff', target.id);
      await revokeAllForOwner('staff', target.id);
    } else {
      await db.prepare('UPDATE parents SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, target.id);
      invalidateTokenCheck('parent', target.id);
      await revokeAllForOwner('parent', target.id);
    }
    await db.prepare("UPDATE reset_requests SET status = 'processed' WHERE id = ?").run(id);
    await audit({
      centerId: target.center_id,
      actor: { id: admin.id, name: admin.name, role: admin.role },
      action: 'reset-password',
      entity: 'reset_requests',
      entityId: id,
      summary: `${admin.name} đặt lại mật khẩu cho ${target.name} (${r.identifier})`,
    });
    // Trả mật khẩu tạm để admin báo lại cho user qua kênh ngoài hệ thống.
    res.json({ ok: true, tempPassword });
  })
);

export default router;
