import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { audit, actorFromReq } from '../../shared/audit';
import { calcPayrollBulk, currentMonth, assertValidMonth } from './payroll.service';

const router = Router();

interface PayrollRow {
  teacher_id: number;
  teacher_name: string;
  sessions: number;
  per_session: number;
}

/** Bảng lương tháng (staff) */
router.get(
  '/',
  requirePermission('payroll.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const q = String((req.query as { month?: string }).month || '');
    const month = q ? (assertValidMonth(q), q) : currentMonth();
    // 1 query duy nhất cho cả bảng lương (trước đây 1 + N query)
    const rows: PayrollRow[] = await calcPayrollBulk(cid, month);
    res.json(rows);
  })
);

/** Lưu định mức lương theo buổi (admin) */
router.put(
  '/rules',
  requirePermission('payroll.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const { teacher_id, per_session_amount } = req.body as {
      teacher_id?: number;
      per_session_amount?: number;
    };
    if (!teacher_id) {
      res.status(400).json({ error: 'Thiếu teacher_id' });
      return;
    }
    const teacher = (await db
      .prepare('SELECT id, center_id FROM teachers WHERE id = ?')
      .get(Number(teacher_id))) as { id: number; center_id: number | null } | undefined;
    if (!teacher || (cid !== null && teacher.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy giáo viên' });
      return;
    }
    const amount = Number(per_session_amount);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) {
      res.status(400).json({ error: 'Số tiền mỗi buổi phải là số nguyên từ 0 đến 100,000,000' });
      return;
    }
    const old = (await db
      .prepare('SELECT per_session_amount FROM salary_rules WHERE teacher_id = ?')
      .get(teacher.id)) as { per_session_amount: number } | undefined;
    await db
      .prepare(
        `INSERT INTO salary_rules (teacher_id, per_session_amount, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(teacher_id) DO UPDATE SET per_session_amount = excluded.per_session_amount, updated_at = datetime('now')`
      )
      .run(teacher.id, amount);
    // Audit: thay đổi định mức lương ảnh hưởng trực tiếp tiền lương
    await audit({
      centerId: cid,
      action: old ? 'update' : 'create',
      entity: 'salary_rules',
      entityId: teacher.id,
      summary: `Đổi định mức lương GV#${teacher.id}: ${old?.per_session_amount ?? 0} → ${amount}đ/buổi`,
      meta: { teacher_id: teacher.id, old_amount: old?.per_session_amount ?? null, new_amount: amount },
      actor: actorFromReq(req),
    });
    res.json({ ok: true });
  })
);

export default router;

/** Dùng chung cho portal giáo viên */
