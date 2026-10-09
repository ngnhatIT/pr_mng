import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { listTeachers } from './teachers.service';
import { audit, actorFromReq } from '../../shared/audit';
import { assertStrongPassword } from '../../shared/password';

const router = Router();

router.get(
  '/',
  requirePermission('teachers.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await listTeachers(reqCenterId(req), { page, limit }));
  })
);

router.post(
  '/',
  requirePermission('teachers.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const { name, phone, email, subject } = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên giáo viên' }),
      phone: v.string({ max: 20, label: 'Số điện thoại' }),
      email: v.string({ max: 100, label: 'Email' }),
      subject: v.string({ max: 100, label: 'Môn dạy' }),
    });
    const r = await db
      .prepare('INSERT INTO teachers (name, phone, email, subject, center_id) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), phone || null, email || null, subject || null, cid);
    res
      .status(201)
      .json(await db.prepare('SELECT * FROM teachers WHERE id = ?').get(Number(r.lastInsertRowid)));
  })
);

router.put(
  '/:id',
  requirePermission('teachers.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const cur = (await db.prepare('SELECT center_id, name FROM teachers WHERE id = ?').get(id)) as
      { center_id: number | null; name: string } | undefined;
    if (!cur || (cid !== null && cur.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy giáo viên' });
      return;
    }
    const { name, phone, email, subject } = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên giáo viên' }),
      phone: v.string({ max: 20, label: 'Số điện thoại' }),
      email: v.string({ max: 100, label: 'Email' }),
      subject: v.string({ max: 100, label: 'Môn dạy' }),
    });
    const r = await db
      .prepare('UPDATE teachers SET name=?, phone=?, email=?, subject=? WHERE id=?')
      .run(name.trim(), phone || null, email || null, subject || null, id);
    if (r.changes === 0) {
      res.status(404).json({ error: 'Không tìm thấy giáo viên' });
      return;
    }
    res.json(await db.prepare('SELECT * FROM teachers WHERE id = ?').get(id));
  })
);

router.delete(
  '/:id',
  requirePermission('teachers.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const cur = (await db.prepare('SELECT center_id, name FROM teachers WHERE id = ?').get(id)) as
      { center_id: number | null; name: string } | undefined;
    if (!cur || (cid !== null && cur.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy giáo viên' });
      return;
    }
    // Chặn xóa giáo viên đã có lịch sử lương (mất cấu hình tính lương, không đối chiếu được)
    const payrollRow = (await db
      .prepare('SELECT COUNT(*) as c FROM salary_rules WHERE teacher_id = ?')
      .get(id)) as { c: string } | undefined;
    if (payrollRow && (Number(payrollRow.c) || 0) > 0) {
      res.status(400).json({
        error: 'Không thể xóa: giáo viên đã có lịch sử lương. Vô hiệu hóa thay vì xóa.',
        code: 'HAS_PAYROLL',
      });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.prepare('UPDATE classes SET teacher_id = NULL WHERE teacher_id = ?').run(id);
      await tx.prepare('DELETE FROM teacher_checkins WHERE teacher_id = ?').run(id);
      await tx.prepare('DELETE FROM salary_rules WHERE teacher_id = ?').run(id);
      await tx.prepare('DELETE FROM teachers WHERE id = ?').run(id);
    });
    void audit({
      centerId: cid,
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'teachers',
      entityId: id,
      summary: `Xóa giáo viên ${cur?.name || `#${id}`}`,
    });
    res.json({ ok: true });
  })
);

/** Tạo tài khoản đăng nhập cho giáo viên (admin): POST /api/teachers/:id/account {username, password} */
router.post(
  '/:id/account',
  requirePermission('users.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const teacher = (await db.prepare('SELECT * FROM teachers WHERE id = ?').get(id)) as
      { id: number; name: string; center_id: number | null } | undefined;
    if (!teacher || (cid !== null && teacher.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy giáo viên' });
      return;
    }
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !username.trim() || !password) {
      res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    try {
      assertStrongPassword(password);
    } catch (err) {
      const e = err as { message?: string };
      res.status(400).json({ error: e.message || 'Mật khẩu quá yếu', code: 'WEAK_PASSWORD' });
      return;
    }
    const exists = await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim());
    if (exists) {
      res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
      return;
    }
    const linked = await db.prepare('SELECT 1 FROM users WHERE teacher_id = ?').get(id);
    if (linked) {
      res.status(400).json({ error: 'Giáo viên này đã có tài khoản đăng nhập' });
      return;
    }
    const hash = bcrypt.hashSync(password, 10);
    const r = await db
      .prepare(
        'INSERT INTO users (username, password_hash, role, name, center_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(username.trim(), hash, 'teacher', teacher.name, teacher.center_id, id);
    res.status(201).json({ ok: true, username: username.trim(), user_id: Number(r.lastInsertRowid) });
  })
);

export default router;
