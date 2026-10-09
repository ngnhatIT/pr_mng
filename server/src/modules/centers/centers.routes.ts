import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { actorFromReq } from '../../shared/audit';
import { listCentersWithCounts, createCenterWithAdmin, getCenter } from './centers.service';
import { db } from '../../db';
import { PLANS } from '../../utils/plans';

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
    const center = await getCenter(id);
    if (!center) {
      res.status(404).json({ error: 'Không tìm thấy trung tâm', code: 'NOT_FOUND' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'Tên trung tâm không được để trống', code: 'BAD_REQUEST' });
        return;
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (body?.phone !== undefined) {
      sets.push('phone = ?');
      params.push(body.phone ? String(body.phone).trim() : null);
    }
    if (body?.address !== undefined) {
      sets.push('address = ?');
      params.push(body.address ? String(body.address).trim() : null);
    }
    if (body?.plan !== undefined) {
      const plan = String(body.plan);
      if (!PLANS[plan]) {
        res
          .status(400)
          .json({ error: `Gói cước không hợp lệ. Chọn một trong: ${Object.keys(PLANS).join(', ')}` });
        return;
      }
      sets.push('plan = ?');
      params.push(plan);
    }
    if (body?.plan_expires_at !== undefined) {
      sets.push('plan_expires_at = ?');
      const expRaw = body.plan_expires_at ? String(body.plan_expires_at).trim() : null;
      // Validate ngày thật
      if (expRaw) {
        const { v: vv, validate: vValidate } = await import('../../shared/validate');
        vValidate({ d: expRaw }, { d: vv.date({ label: 'Hạn gói' }) });
      }
      params.push(expRaw);
    }
    if (sets.length > 0) {
      await db.prepare(`UPDATE centers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    }
    res.json(await getCenter(id));
  })
);

export default router;
