import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { PLANS, listCenters, getCenter, Center } from '../../utils/plans';
import { asyncHandler } from '../../shared/http';

const router = Router();
router.use(requirePermission('system.manage'));

/**
 * Chỉ superadmin được xem/sửa danh sách trung tâm.
 * Role admin có permission 'system.manage' scope 'center' nên KHÔNG đủ —
 * phải kiểm tra role trực tiếp (chống leo thang đặc quyền: admin tự đổi plan).
 */
function superadminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ error: 'Chỉ quản trị hệ thống mới có quyền này' });
    return;
  }
  next();
}

async function withCounts(c: Center) {
  const studentCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM students WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  const userCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM users WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  const classCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM classes WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  return { ...c, student_count: studentCount, user_count: userCount, class_count: classCount };
}

/* ------------------------- Danh sách trung tâm ------------------------- */

// GET /api/centers — chỉ superadmin
router.get(
  '/',
  superadminOnly,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(await Promise.all((await listCenters()).map(withCounts)));
  })
);

/* ------------------------- Tạo trung tâm + admin ------------------------- */

// POST /api/centers
router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const subdomain = body?.subdomain ? String(body.subdomain).trim().toLowerCase() : null;
    const phone = body?.phone ? String(body.phone).trim() : null;
    const address = body?.address ? String(body.address).trim() : null;
    const plan = body?.plan ? String(body.plan) : 'standard';
    const planExpiresAt = body?.plan_expires_at ? String(body.plan_expires_at).trim() : null;
    const adminUsername = String(body?.admin_username ?? '').trim();
    const adminPassword = String(body?.admin_password ?? '');

    if (!name) {
      res.status(400).json({ error: 'Tên trung tâm là bắt buộc' });
      return;
    }
    if (adminUsername.length < 4) {
      res.status(400).json({ error: 'Tên đăng nhập admin phải từ 4 ký tự trở lên' });
      return;
    }
    if (adminPassword.length < 4) {
      res.status(400).json({ error: 'Mật khẩu admin phải từ 4 ký tự trở lên' });
      return;
    }
    if (!PLANS[plan]) {
      res
        .status(400)
        .json({ error: `Gói cước không hợp lệ. Chọn một trong: ${Object.keys(PLANS).join(', ')}` });
      return;
    }
    if (subdomain) {
      const dup = await db.prepare('SELECT id FROM centers WHERE subdomain = ?').get(subdomain);
      if (dup) {
        res.status(400).json({ error: 'Subdomain đã được sử dụng' });
        return;
      }
    }
    const usernameTaken = await db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
    if (usernameTaken) {
      res.status(400).json({ error: 'Tên đăng nhập admin đã tồn tại' });
      return;
    }

    const centerId = await db.transaction(async (tx) => {
      const r = await tx
        .prepare(
          'INSERT INTO centers (name, subdomain, phone, address, plan, plan_expires_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(name, subdomain, phone, address, plan, planExpiresAt);
      const centerId = Number(r.lastInsertRowid);
      const hash = bcrypt.hashSync(adminPassword, 10);
      await tx
        .prepare(
          "INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, 'admin', ?, ?)"
        )
        .run(adminUsername, hash, `Quản trị ${name}`, centerId);
      return centerId;
    });
    res.status(201).json({ ok: true, center_id: centerId });
  })
);

/* ------------------------- Cập nhật trung tâm ------------------------- */

// PUT /api/centers/:id — chỉ superadmin (admin không được đổi plan của bất kỳ center nào)
router.put(
  '/:id',
  superadminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);
    const center = await getCenter(id);
    if (!center) {
      res.status(404).json({ error: 'Không tìm thấy trung tâm' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'Tên trung tâm không được để trống' });
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
      params.push(body.plan_expires_at ? String(body.plan_expires_at).trim() : null);
    }
    if (sets.length > 0) {
      await db.prepare(`UPDATE centers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    }
    res.json(await getCenter(id));
  })
);

export default router;
