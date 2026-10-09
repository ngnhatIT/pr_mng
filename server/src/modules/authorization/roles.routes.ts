/**
 * API quản trị phân quyền (roles & permissions).
 * Yêu cầu: roles.view để xem, roles.manage để thay đổi.
 */
import { Router, Response } from 'express';
import { AuthRequest, requireAuth, reqCenterId } from '../../middleware/auth';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { AppError } from '../../shared/errors';
import { db } from '../../db/pg-compat';
import { audit } from '../../shared/audit';
import { actorFromReq } from '../../shared/audit';
import { requirePermission } from './authorization.middleware';
import {
  invalidateUserPermissions,
  invalidateAllPermissions,
  getUserPermissions,
  setRolePermissions,
} from './authorization.service';
import { PERMISSIONS } from './permissions';

const router = Router();
router.use(requireAuth);

/** Danh mục tất cả permissions (để UI hiển thị) */
router.get(
  '/permissions',
  requirePermission('roles.view'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const rows = (await db
      .prepare('SELECT id, code, name, description, module FROM permissions ORDER BY module, code')
      .all()) as unknown[];
    res.json({ catalog: PERMISSIONS.length, rows });
  })
);

/** Danh sách roles (kèm số permissions, số users) */
router.get(
  '/',
  requirePermission('roles.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = req.user!.role === 'superadmin' ? null : (req.user!.center_id ?? null);
    const rows = (await db
      .prepare(
        `SELECT r.id, r.code, r.name, r.description, r.is_system, r.center_id,
        (SELECT COUNT(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) as perm_count,
        (SELECT COUNT(*)::int FROM user_roles ur WHERE ur.role_id = r.id) as user_count
       FROM roles r
       WHERE r.center_id IS NULL OR r.center_id IS NOT DISTINCT FROM ?
       ORDER BY r.is_system DESC, r.name`
      )
      .all(cid)) as unknown[];
    res.json(rows);
  })
);

/** Chi tiết role + permissions */
router.get(
  '/:id',
  requirePermission('roles.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const role = (await db.prepare('SELECT * FROM roles WHERE id = ?').get(id)) as
      Record<string, unknown> | undefined;
    if (!role) throw AppError.notFound('Không tìm thấy vai trò');
    const perms = (await db
      .prepare(
        `SELECT p.code, p.name, p.module, rp.scope
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ? ORDER BY p.module, p.code`
      )
      .all(id)) as unknown[];
    res.json({ ...role, permissions: perms });
  })
);

const roleSchema = {
  code: v.string({ required: true, max: 50, label: 'Mã vai trò' }),
  name: v.string({ required: true, max: 100, label: 'Tên vai trò' }),
  description: v.string({ max: 500, label: 'Mô tả' }),
};

/** Tạo custom role */
router.post(
  '/',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, roleSchema);
    const code = String(input.code)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const centerId = req.user!.role === 'superadmin' ? null : (req.user!.center_id ?? null);
    try {
      const r = await db
        .prepare('INSERT INTO roles (code, name, description, center_id) VALUES (?, ?, ?, ?)')
        .run(code, input.name, input.description ?? null, centerId);
      res.status(201).json({ id: Number(r.lastInsertRowid), code });
    } catch {
      throw AppError.conflict('Mã vai trò đã tồn tại');
    }
  })
);

/** Sửa custom role (không sửa system role) */
router.put(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const role = (await db.prepare('SELECT is_system, center_id FROM roles WHERE id = ?').get(id)) as
      | { is_system: boolean; center_id: number | null }
      | undefined;
    if (!role) throw AppError.notFound('Không tìm thấy vai trò');
    if (role.is_system) throw AppError.badRequest('Không được sửa vai trò hệ thống');
    // Admin chỉ sửa role của trung tâm mình
    const cid = reqCenterId(req);
    if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
    const input = validate(req.body, {
      name: v.string({ max: 100, label: 'Tên' }),
      description: v.string({ max: 500, label: 'Mô tả' }),
    });
    await db
      .prepare(
        'UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
      )
      .run(input.name ?? null, input.description ?? null, id);
    res.json({ ok: true });
  })
);

/** Xóa custom role */
router.delete(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const role = (await db.prepare('SELECT is_system, center_id FROM roles WHERE id = ?').get(id)) as
      | { is_system: boolean; center_id: number | null }
      | undefined;
    if (!role) throw AppError.notFound('Không tìm thấy vai trò');
    if (role.is_system) throw AppError.badRequest('Không được xóa vai trò hệ thống');
    // Admin chỉ xóa role của trung tâm mình
    const cid = reqCenterId(req);
    if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
    await db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    invalidateAllPermissions();
    // Audit xóa role (thao tác phân quyền nhạy cảm)
    void audit({
      centerId: null,
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'roles',
      entityId: id,
      summary: `Xóa vai trò #${id}`,
    });
    res.json({ ok: true });
  })
);

/** Gán permissions cho role (thay thế toàn bộ) */
router.put(
  '/:id/permissions',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    // Admin chỉ sửa permissions của role thuộc trung tâm mình
    const role = (await db
      .prepare('SELECT is_system, center_id FROM roles WHERE id = ?')
      .get(id)) as { is_system: boolean; center_id: number | null } | undefined;
    if (!role) throw AppError.notFound('Không tìm thấy vai trò');
    if (role.is_system) throw AppError.badRequest('Không được sửa vai trò hệ thống');
    const cid = reqCenterId(req);
    if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
    const items = (req.body as { permissions?: { code: string; scope: string }[] }).permissions ?? [];
    res.json({ ok: true, ...(await setRolePermissions(id, items)) });
  })
);

/** Gán role cho user */
router.post(
  '/assign',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id, role_id } = validate(req.body, {
      user_id: v.number({ required: true, label: 'User' }),
      role_id: v.number({ required: true, label: 'Role' }),
    });
    const cid = reqCenterId(req);
    // Chặn gán role hệ thống (superadmin/admin/staff/teacher) — chỉ superadmin được gán qua flow riêng
    const role = (await db
      .prepare('SELECT id, is_system, center_id FROM roles WHERE id = ?')
      .get(role_id)) as { id: number; is_system: boolean; center_id: number | null } | undefined;
    if (!role) {
      res.status(404).json({ error: 'Không tìm thấy role', code: 'NOT_FOUND' });
      return;
    }
    if (role.is_system && req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Chỉ superadmin được gán role hệ thống', code: 'FORBIDDEN' });
      return;
    }
    // Admin chỉ gán role của trung tâm mình
    if (cid !== null && role.center_id !== cid) {
      res.status(404).json({ error: 'Không tìm thấy role', code: 'NOT_FOUND' });
      return;
    }
    // User được gán phải thuộc trung tâm mình
    const targetUser = (await db
      .prepare('SELECT id, center_id FROM users WHERE id = ?')
      .get(user_id)) as { id: number; center_id: number | null } | undefined;
    if (!targetUser || (cid !== null && targetUser.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy người dùng', code: 'NOT_FOUND' });
      return;
    }
    await db
      .prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(user_id, role_id);
    invalidateUserPermissions(Number(user_id));
    res.json({ ok: true });
  })
);

/** Gỡ role khỏi user */
router.delete(
  '/assign',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id, role_id } = validate(
      { ...req.query, ...req.body },
      {
        user_id: v.number({ required: true, label: 'User' }),
        role_id: v.number({ required: true, label: 'Role' }),
      }
    );
    const cid = reqCenterId(req);
    // Chặn gỡ role hệ thống (chỉ superadmin) và check center
    const role = (await db
      .prepare('SELECT is_system, center_id FROM roles WHERE id = ?')
      .get(role_id)) as { is_system: boolean; center_id: number | null } | undefined;
    if (!role) throw AppError.notFound('Không tìm thấy vai trò');
    if (role.is_system && req.user?.role !== 'superadmin') {
      throw AppError.forbidden('Chỉ superadmin được gỡ role hệ thống');
    }
    if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
    const targetUser = (await db
      .prepare('SELECT center_id FROM users WHERE id = ?')
      .get(user_id)) as { center_id: number | null } | undefined;
    if (!targetUser || (cid !== null && targetUser.center_id !== cid)) {
      throw AppError.notFound('Không tìm thấy người dùng');
    }
    await db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(user_id, role_id);
    invalidateUserPermissions(Number(user_id));
    res.json({ ok: true });
  })
);

/** Permissions hiện tại của chính mình (để frontend ẩn/hiện menu) */
router.get(
  '/me/permissions',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const perms = await getUserPermissions(req.user!.id);
    res.json([...perms.entries()].map(([code, scope]) => ({ code, scope })));
  })
);

export default router;
