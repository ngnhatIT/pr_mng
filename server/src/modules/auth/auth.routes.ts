import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  AuthUser,
  DUMMY_PASSWORD_HASH,
  requireAuth,
  reqCenterId,
  type AuthRequest,
} from '../../middleware/auth';
import { loginRateLimit, loginAccountKey } from '../../middleware/rateLimit';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { paramId } from '../../shared/validate';
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  logoutOtherSessions,
} from './refresh.service';
import {
  findLoginUser,
  changePassword,
  createResetRequest,
  listResetRequests,
  processResetRequest,
} from './auth.service';
import { resolvePublicCenter, getCenter } from '../../utils/plans';
import { normalizePhone } from '../../services/zalo';
import { audit } from '../../shared/audit';
import { logger } from '../../shared/logger';
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
  requireSameOrigin,
  setDeviceCookie,
} from '../../middleware/cookieAuth';

/** Path cookie refresh cho staff: tách khỏi parent để 2 phiên không đè nhau. */
const COOKIE_PATH = '/api/v1/auth';

const log = logger.scope('auth');

const router = Router();

/** Thêm center_name (tên thật của trung tâm, null cho superadmin) — client in biên lai/tiêu đề. */
export async function withCenterName<T extends { center_id?: number | null }>(
  u: T
): Promise<T & { center_name: string | null }> {
  return { ...u, center_name: u.center_id != null ? ((await getCenter(u.center_id))?.name ?? null) : null };
}

function reqMeta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    // CORR-4: kiểm kiểu — password không phải string làm bcrypt ném 'Illegal arguments' -> 500
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username ||
      !password ||
      username.length > 100 ||
      password.length > 200
    ) {
      res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu', code: 'BAD_REQUEST' });
      return;
    }
    const user = await findLoginUser(username);
    // PERF-2: bcrypt async — compareSync chặn event loop của cả worker
    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      // Log failed login để phát hiện brute-force (không log password)
      log.warn('Đăng nhập thất bại', { username, ip: reqMeta(req).ip });
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng', code: 'UNAUTHORIZED' });
      return;
    }
    // D2: từ chối tài khoản đã bị khóa
    if (!user.is_active) {
      log.warn('Đăng nhập bị từ chối: tài khoản đã khóa', { username, ip: reqMeta(req).ip });
      res
        .status(403)
        .json({ error: 'Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên', code: 'ACCOUNT_LOCKED' });
      return;
    }
    // SEC-5: user thường không gán trung tâm -> không cấp token (nếu không sẽ thành scope toàn hệ thống)
    if (user.role !== 'superadmin' && user.center_id == null) {
      log.warn('Đăng nhập bị từ chối: tài khoản chưa gán trung tâm', { username, ip: reqMeta(req).ip });
      res.status(403).json({ error: 'Tài khoản chưa được gán trung tâm', code: 'NO_CENTER' });
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
      must_change_password: !!user.must_change_password, // N-5
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
    // S-4: thiết bị đã đăng nhập đúng -> bucket rate-limit riêng, không bị kẻ tấn công khóa theo username
    setDeviceCookie(res, 'staff', loginAccountKey(req.body), COOKIE_PATH);
    res.json({ token: pair.token, expires_in: pair.expires_in, user: await withCenterName(payload) });
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
    res.json({ token: pair.token, expires_in: pair.expires_in, user: await withCenterName(pair.user) });
  })
);

/** Thông tin user hiện tại (payload token + center_name). */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { iat: _iat, exp: _exp, tv: _tv, ...user } = req.user! as AuthUser & { iat?: number; exp?: number };
    // N-5: luôn có must_change_password (token ký trước v25 không có cờ = false)
    res.json({ user: await withCenterName({ ...user, must_change_password: !!user.must_change_password }) });
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

/**
 * Đăng xuất mọi thiết bị KHÁC (khi nghi lộ credential): thu hồi mọi refresh token trừ token
 * của phiên hiện tại, tăng token_version (access token bị lộ chết ngay) và trả access token mới
 * để phiên hiện tại không bị đá ra.
 */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const token = await logoutOtherSessions(req.user!, getRefreshCookie(req));
    res.json({ ok: true, token });
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
    if (
      !old_password ||
      !new_password ||
      typeof old_password !== 'string' ||
      typeof new_password !== 'string'
    ) {
      res
        .status(400)
        .json({ error: 'Vui lòng nhập mật khẩu cũ và mật khẩu mới', code: 'VALIDATION_REQUIRED' });
      return;
    }
    // D4: giữ phiên hiện tại — refresh token từ cookie (fallback body cho client cũ trong đợt rolling deploy)
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    await changePassword(u, old_password, new_password, getRefreshCookie(req) ?? refresh_token);
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
    const raw = kind === 'parent' ? String(phone ?? '').trim() : String(username ?? '').trim();
    // SĐT lưu dạng chuẩn hóa (0xxxxxxxxx) như bảng parents, để tra đúng tài khoản khi xử lý
    const identifier = kind === 'parent' ? (normalizePhone(raw) ?? raw) : raw;
    if ((kind !== 'staff' && kind !== 'parent') || !identifier || identifier.length > 100) {
      res
        .status(400)
        .json({ error: 'Thiếu thông tin yêu cầu đặt lại mật khẩu', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const hostCenterId = kind === 'parent' ? ((await resolvePublicCenter(req))?.id ?? null) : null;
    await createResetRequest(kind, identifier, hostCenterId);
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
    // Superadmin thấy mọi trung tâm; admin chỉ thấy yêu cầu của trung tâm mình (chống lộ PII xuyên tenant)
    const rows = await listResetRequests(reqCenterId(req));
    res.json({ data: rows });
  })
);

/** Admin: xử lý yêu cầu — sinh mật khẩu tạm, đá mọi session cũ của tài khoản, đánh dấu đã xử lý. */
router.post(
  '/reset-requests/:id/process',
  requireAuth,
  requirePermission('users.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tempPassword } = await processResetRequest(reqCenterId(req), paramId(req.params), req.user!);
    // Trả mật khẩu tạm để admin báo lại cho user qua kênh ngoài hệ thống.
    res.json({ ok: true, tempPassword });
  })
);

export default router;
