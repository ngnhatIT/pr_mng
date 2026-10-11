/**
 * API quản trị phân quyền (roles & permissions).
 * Yêu cầu: roles.view để xem, roles.manage để thay đổi. SQL nằm ở authorization.service.ts.
 */
import { Router, Response } from 'express';
import { AuthRequest, requireAuth, reqCenterId } from '../../middleware/auth';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { audit, actorFromReq } from '../../shared/audit';
import { requirePermission } from './authorization.middleware';
import {
  getUserPermissions,
  setRolePermissions,
  listPermissionCatalog,
  listRoles,
  getRoleDetail,
  listAssignableUsers,
  getEditableRole,
  createRole,
  updateRole,
  deleteRole,
  assignRole,
  unassignRole,
} from './authorization.service';
import { PERMISSIONS } from './permissions';

const router = Router();
router.use(requireAuth);

/** Danh mục tất cả permissions (để UI hiển thị) */
router.get(
  '/permissions',
  requirePermission('roles.view'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json({ catalog: PERMISSIONS.length, rows: await listPermissionCatalog() });
  })
);

/** Danh sách roles (kèm số permissions, số users) */
router.get(
  '/',
  requirePermission('roles.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await listRoles(reqCenterId(req)));
  })
);

/** Nhân sự có thể gán custom role (route tĩnh — đăng ký trước '/:id') */
router.get(
  '/users',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await listAssignableUsers(reqCenterId(req)));
  })
);

// R4-1: các route tĩnh (/assign) PHẢI đăng ký trước '/:id' — nếu không DELETE /assign rơi vào DELETE /:id (400)
/** Gán role cho user */
router.post(
  '/assign',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { user_id, role_id } = validate(req.body, {
      user_id: v.number({ required: true, label: 'User' }),
      role_id: v.number({ required: true, label: 'Role' }),
    });
    await assignRole(reqCenterId(req), Number(user_id), Number(role_id), req.user!, actorFromReq(req));
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
    await unassignRole(reqCenterId(req), Number(user_id), Number(role_id), req.user!, actorFromReq(req));
    res.json({ ok: true });
  })
);

/** Chi tiết role + permissions (role riêng của trung tâm khác -> 404) */
router.get(
  '/:id',
  requirePermission('roles.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await getRoleDetail(reqCenterId(req), paramId(req.params)));
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
    res
      .status(201)
      .json(
        await createRole(
          reqCenterId(req),
          { code: String(input.code), name: input.name, description: input.description },
          actorFromReq(req)
        )
      );
  })
);

/** Sửa custom role (không sửa system role, admin chỉ sửa role của trung tâm mình) */
router.put(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const cid = reqCenterId(req);
    await getEditableRole(cid, id, 'Không được sửa vai trò hệ thống'); // 404/400 trước khi validate body
    const input = validate(req.body, {
      name: v.string({ max: 100, label: 'Tên' }),
      description: v.string({ max: 500, label: 'Mô tả' }),
    });
    await updateRole(cid, id, input, req.user!);
    res.json({ ok: true });
  })
);

/** Xóa custom role */
router.delete(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteRole(reqCenterId(req), paramId(req.params), req.user!, actorFromReq(req));
    res.json({ ok: true });
  })
);

/** Gán permissions cho role (thay thế toàn bộ) */
router.put(
  '/:id/permissions',
  requirePermission('roles.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const role = await getEditableRole(reqCenterId(req), id, 'Không được sửa vai trò hệ thống');
    const result = await setRolePermissions(
      id,
      (req.body as { permissions?: unknown } | undefined)?.permissions,
      req.user!
    );
    await audit({
      centerId: role.center_id,
      actor: actorFromReq(req),
      action: 'update',
      entity: 'roles',
      entityId: id,
      summary: `Đặt ${result.count} quyền cho vai trò #${id}`,
      meta: { permissions: result.permissions },
    });
    res.json({ ok: true, count: result.count });
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
