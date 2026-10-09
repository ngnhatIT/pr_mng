import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { calcPayroll, currentMonth, MONTH_RE } from './payroll.service';

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
    const month = MONTH_RE.test(q) ? q : currentMonth();
    const teachers = (await db
      .prepare(`SELECT id, name FROM teachers ${cid !== null ? 'WHERE center_id = ?' : ''} ORDER BY name`)
      .all(...(cid !== null ? [cid] : []))) as { id: number; name: string }[];
    const rows: PayrollRow[] = await Promise.all(
      teachers.map(async (t) => ({
        teacher_id: t.id,
        teacher_name: t.name,
        ...(await calcPayroll(t.id, month)),
      }))
    );
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
    if (Number.isNaN(amount) || amount < 0) {
      res.status(400).json({ error: 'Số tiền mỗi buổi không hợp lệ' });
      return;
    }
    await db
      .prepare(
        `INSERT INTO salary_rules (teacher_id, per_session_amount, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(teacher_id) DO UPDATE SET per_session_amount = excluded.per_session_amount, updated_at = datetime('now')`
      )
      .run(teacher.id, amount);
    res.json({ ok: true });
  })
);

export default router;

/** Dùng chung cho portal giáo viên */
