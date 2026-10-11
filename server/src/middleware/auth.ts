import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db, requestActor } from '../db/pg-compat';
import { AppError } from '../shared/errors';

/**
 * Secret ký JWT — NGUỒN DUY NHẤT là config/env (đọc từ biến môi trường JWT_SECRET).
 * Không bao giờ hardcode secret trong source code.
 */
export const JWT_SECRET = env.JWT_SECRET;

export interface AuthUser {
  id: number;
  username: string;
  role: string; // superadmin | admin | staff | teacher | parent
  name: string;
  /** Namespace phân biệt id: 'parent' = id của bảng parents, 'staff' = id của bảng users. Chống C1. */
  kind?: 'parent' | 'staff';
  /** D2: token version — tăng khi đổi mật khẩu/khóa tài khoản để thu hồi access token ngay. */
  tv?: number;
  /** null = superadmin (thấy mọi trung tâm) */
  center_id?: number | null;
  parent_id?: number;
  teacher_id?: number | null;
  /**
   * N-5: mật khẩu tạm (đặt lại / admin cấp) — token chỉ dùng được cho đổi mật khẩu + /auth/me.
   * Nhúng trong JWT an toàn vì mọi lần đổi cờ trong DB đều tăng token_version (token cũ chết ngay).
   */
  must_change_password?: boolean;
}

/**
 * Hash bcrypt giả dùng khi user không tồn tại — luôn chạy compare để chống
 * timing side-channel (M6). Giá trị cố định, KHÔNG phải mật khẩu thật của ai.
 */
export const DUMMY_PASSWORD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export const JWT_VERIFY_OPTS: jwt.VerifyOptions = { algorithms: ['HS256'] };

export interface AuthRequest extends Request {
  user?: AuthUser;
  /** File upload từ multer (uploadSingle). */
  file?: Express.Multer.File;
}

export function signToken(
  user: AuthUser,
  expiresIn: number | `${number}${'s' | 'm' | 'h' | 'd'}` = '15m'
): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn });
}

/* ---------------- D2: thu hồi access token ngay ---------------- */

/** Cache (kind:id) → {tv, active} — TTL 60s để đổi pass/khóa TK có hiệu lực nhanh mà không query DB mỗi request. */
const tokenCheckCache = new Map<string, { at: number; tv: number; active: boolean }>();
const TOKEN_CHECK_TTL_MS = 60_000;

/** Xóa cache kiểm tra token của 1 tài khoản — gọi sau khi tăng token_version hoặc khóa/mở TK. */
export function invalidateTokenCheck(kind: 'parent' | 'staff', id: number): void {
  tokenCheckCache.delete(`${kind}:${id}`);
}

type TokenStatus = 'ok' | 'revoked' | 'locked';

/**
 * Kiểm tra access token còn hiệu lực không: so tv trong JWT với DB, và is_active.
 * C-6: token không có tv bị coi là đã thu hồi (mọi nơi ký token đều nhúng tv từ D2; không còn
 * nhánh bỏ qua kiểm tra cho token cũ).
 */
async function checkTokenFreshness(payload: AuthUser): Promise<TokenStatus> {
  if (payload.tv == null) return 'revoked';
  const kind = payload.kind === 'parent' || payload.role === 'parent' ? 'parent' : 'staff';
  const id = kind === 'parent' ? (payload.parent_id ?? payload.id) : payload.id;
  const key = `${kind}:${id}`;
  const hit = tokenCheckCache.get(key);
  let tv: number;
  let active: boolean;
  if (hit && Date.now() - hit.at < TOKEN_CHECK_TTL_MS) {
    ({ tv, active } = hit);
  } else {
    const row = (await db
      .prepare(`SELECT token_version, is_active FROM ${kind === 'parent' ? 'parents' : 'users'} WHERE id = ?`)
      .get(id)) as { token_version: number; is_active: boolean } | undefined;
    if (!row) return 'revoked'; // tài khoản đã bị xóa
    tv = row.token_version;
    active = row.is_active;
    tokenCheckCache.set(key, { at: Date.now(), tv, active });
  }
  if (!active) return 'locked';
  return tv === payload.tv ? 'ok' : 'revoked';
}

/** N-5: route vẫn dùng được khi đang giữ mật khẩu tạm (kể cả alias /api không version). */
const MUST_CHANGE_ALLOWED = /^\/api(\/v1)?\/(auth\/(me|change-password)|parent\/change-password)\/?$/;

/**
 * Verify xong → kiểm tra thu hồi/khóa (bất đồng bộ). Mọi lỗi bên trong đều biến
 * thành 401, không throw ra ngoài (Express 4 không hứng được lỗi từ middleware async).
 */
function finishAuth(req: AuthRequest, res: Response, next: NextFunction, payload: AuthUser): void {
  checkTokenFreshness(payload).then(
    (status) => {
      if (status === 'locked') {
        res
          .status(403)
          .json({ error: 'Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên', code: 'ACCOUNT_LOCKED' });
        return;
      }
      if (status !== 'ok') {
        res
          .status(401)
          .json({ error: 'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại', code: 'TOKEN_REVOKED' });
        return;
      }
      // N-5: mật khẩu tạm -> chỉ cho xem /auth/me và đổi mật khẩu (refresh/logout không qua middleware này)
      if (payload.must_change_password && !MUST_CHANGE_ALLOWED.test(req.originalUrl.split('?')[0])) {
        res.status(403).json({
          error: 'Bạn cần đổi mật khẩu tạm trước khi tiếp tục',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
        return;
      }
      req.user = payload;
      withActorContext(payload, next);
    },
    () => {
      res.status(401).json({ error: 'Không xác thực được phiên đăng nhập', code: 'INVALID_TOKEN' });
    }
  );
}

/** Chạy downstream trong AsyncLocalStorage mang actor '<id>:<role>' để trigger audit ghi changed_by. */
function withActorContext(user: AuthUser, next: NextFunction): void {
  const role = typeof user.role === 'string' && /^[A-Za-z_]+$/.test(user.role) ? user.role : 'unknown';
  requestActor.run(`${user.id}:${role}`, () => next());
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Thiếu token đăng nhập', code: 'NO_TOKEN' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, JWT_VERIFY_OPTS) as AuthUser;
    finishAuth(req, res, next, payload);
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn', code: 'INVALID_TOKEN' });
  }
}

/** Chỉ cho phụ huynh (portal /api/parent) */
export function parentAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản phụ huynh', code: 'PARENT_AUTH_REQUIRED' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, JWT_VERIFY_OPTS) as AuthUser;
    if (payload.role !== 'parent' || !payload.parent_id) {
      res.status(403).json({ error: 'Tài khoản này không phải phụ huynh', code: 'NOT_PARENT' });
      return;
    }
    finishAuth(req, res, next, payload);
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn', code: 'INVALID_TOKEN' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Không có quyền thực hiện', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

/** Chặn tài khoản phụ huynh truy cập API nhân sự (dùng sau requireAuth ở mount) */
export function denyParents(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role === 'parent') {
    res.status(403).json({ error: 'Tài khoản phụ huynh không có quyền truy cập', code: 'FORBIDDEN' });
    return;
  }
  next();
}

/** Vai trò nhân sự (được dùng chung app quản trị /app) */
export const STAFF_ROLES = ['superadmin', 'admin', 'staff'];
export const adminOnly = requireRole('admin', 'superadmin');
export const superadminOnly = requireRole('superadmin');

/**
 * Lấy center_id hiệu lực của request.
 * - User thường -> center của mình. Fail-closed: không có center_id (dữ liệu lệch) -> 403,
 *   không bao giờ coi là toàn hệ thống.
 * - Superadmin: mặc định null (toàn hệ thống); có `?center_id=` (ô chọn trung tâm trên
 *   thanh tiêu đề, client tự gắn) -> thao tác như trung tâm đó, đọc lẫn ghi.
 */
export function reqCenterId(req: AuthRequest): number | null {
  if (!req.user) return null;
  if (req.user.role === 'superadmin') {
    const raw = (req.query as Record<string, unknown> | undefined)?.center_id;
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'center_id không hợp lệ', 'VALIDATION_ERROR');
    return n;
  }
  const cid = req.user.center_id;
  if (typeof cid === 'number') return cid;
  throw new AppError(403, 'Tài khoản chưa được gán trung tâm', 'NO_CENTER');
}

/**
 * Trung tâm đích cho thao tác GHI dữ liệu thuộc tenant. User thường -> center của mình.
 * Superadmin bắt buộc chỉ rõ center_id (query hoặc body) — không còn ngầm rơi vào
 * trung tâm id nhỏ nhất (ghi nhầm tenant #1).
 */
export function requireCenterId(req: AuthRequest): number {
  const cid = reqCenterId(req);
  if (cid !== null) return cid;
  // Không có ?center_id (reqCenterId đã xử lý) -> chấp nhận center_id trong body.
  const n = Number((req.body as Record<string, unknown> | undefined)?.center_id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(
      400,
      'Superadmin cần chọn trung tâm (ô "Trung tâm" trên thanh tiêu đề) trước khi thao tác',
      'CENTER_REQUIRED'
    );
  }
  return n;
}
