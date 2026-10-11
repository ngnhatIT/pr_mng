import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { actorFromReq } from '../../shared/audit';
import { listCentersWithCounts, createCenterWithAdmin, getCenter, updateCenter } from './centers.service';

const router = Router();
router.use(requirePermission('system.manage'));

/**
 * Chỉ superadmin được xem/sửa danh sách trung tâm.
 * Role admin có permission 'system.manage' scope 'center' nên KHÔNG đủ —
 * phải kiểm tra role trực tiếp (chống leo thang đặc quyền: admin tự đổi plan).
 */
function superadminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ error: 'Chỉ quản trị hệ thống mới có quyền này', code: 'FORBIDDEN' });
    return;
  }
  next();
}

/* ------------------------- Danh sách trung tâm ------------------------- */

// GET /api/centers — chỉ superadmin
router.get(
  '/',
  superadminOnly,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(await listCentersWithCounts());
  })
);

/* ------------------------- Tạo trung tâm + admin ------------------------- */

// POST /api/centers
router.post(
  '/',
  superadminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      name: v.string({ required: true, label: 'Tên trung tâm' }),
      subdomain: v.string({ required: false, label: 'Subdomain' }),
      phone: v.string({ required: false, label: 'Số điện thoại' }),
      address: v.string({ required: false, label: 'Địa chỉ' }),
      plan: v.string({ required: false, label: 'Gói cước' }),
      plan_expires_at: v.date({ required: false, label: 'Hạn gói' }),
      admin_username: v.string({ required: true, label: 'Tên đăng nhập admin' }),
      admin_password: v.string({ required: true, label: 'Mật khẩu admin' }),
    });
    const result = await createCenterWithAdmin(
      {
        name: input.name,
        subdomain: input.subdomain ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        plan: input.plan ?? 'standard',
        plan_expires_at: input.plan_expires_at ?? null,
        admin_username: input.admin_username,
        admin_password: input.admin_password,
      },
      actorFromReq(req)
    );
    res.status(201).json({ ok: true, ...result });
  })
);

/* ------------------------- Cập nhật trung tâm ------------------------- */

// PUT /api/centers/:id — chỉ superadmin (admin không được đổi plan của bất kỳ center nào)
router.put(
  '/:id',
  superadminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await updateCenter(id, (req.body ?? {}) as Record<string, unknown>);
    res.json(await getCenter(id));
  })
);

export default router;
