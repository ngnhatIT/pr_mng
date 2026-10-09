import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { requestActor } from '../db/pg-compat';

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
  /** null = superadmin (thấy mọi trung tâm) */
  center_id?: number | null;
  parent_id?: number;
  teacher_id?: number | null;
}

/**
 * Hash bcrypt giả dùng khi user không tồn tại — luôn chạy compare để chống
 * timing side-channel (M6). Giá trị cố định, KHÔNG phải mật khẩu thật của ai.
 */
export const DUMMY_PASSWORD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const JWT_VERIFY_OPTS: jwt.VerifyOptions = { algorithms: ['HS256'] };

export interface AuthRequest extends Request {
  user?: AuthUser;
  /** File upload từ multer (uploadSingle). */
  file?: Express.Multer.File;
}

export function signToken(
  user: AuthUser,
  expiresIn: number | `${number}${'s' | 'm' | 'h' | 'd'}` = '1h'
): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn });
}

/** Chạy downstream trong AsyncLocalStorage mang actor '<id>:<role>' để trigger audit ghi changed_by. */
function withActorContext(user: AuthUser, next: NextFunction): void {
  const role = typeof user.role === 'string' && /^[A-Za-z_]+$/.test(user.role) ? user.role : 'unknown';
  requestActor.run(`${user.id}:${role}`, () => next());
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Thiếu token đăng nhập' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, JWT_VERIFY_OPTS) as AuthUser;
    req.user = payload;
    withActorContext(payload, next);
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

/** Chỉ cho phụ huynh (portal /api/parent) */
export function parentAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản phụ huynh' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, JWT_VERIFY_OPTS) as AuthUser;
    if (payload.role !== 'parent' || !payload.parent_id) {
      res.status(403).json({ error: 'Tài khoản này không phải phụ huynh' });
      return;
    }
    req.user = payload;
    withActorContext(payload, next);
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Không có quyền thực hiện' });
      return;
    }
    next();
  };
}

/** Chặn tài khoản phụ huynh truy cập API nhân sự (dùng sau requireAuth ở mount) */
export function denyParents(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role === 'parent') {
    res.status(403).json({ error: 'Tài khoản phụ huynh không có quyền truy cập' });
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
 * Trả về null cho superadmin (không giới hạn trung tâm).
 */
export function reqCenterId(req: AuthRequest): number | null {
  if (!req.user) return null;
  if (req.user.role === 'superadmin') return null;
  const cid = req.user.center_id;
  return typeof cid === 'number' ? cid : null;
}
