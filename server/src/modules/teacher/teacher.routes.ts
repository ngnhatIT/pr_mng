import { Router, Response } from 'express';
import { db, toISODate } from '../../db';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { calcPayroll, currentMonth, MONTH_RE } from '../payroll/payroll.service';
import { asyncHandler } from '../../shared/http';

const router = Router();

/** Portal giáo viên — phân quyền theo permission (teacher: scope own; admin/superadmin: full). */

/** Lấy teacher_id hiệu lực (giáo viên tự xem; admin xem hộ qua query) */
function effTeacherId(req: AuthRequest): number | null {
  if (req.user?.teacher_id) return req.user.teacher_id;
  const q = Number((req.query as { teacher_id?: string }).teacher_id);
  return Number.isFinite(q) && q > 0 ? q : null;
}

/** Các buổi dạy hôm nay */
router.get(
  '/today',
  requirePermission('sessions.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = effTeacherId(req);
    if (!tid) {
      res.status(400).json({ error: 'Tài khoản chưa gắn với giáo viên nào' });
      return;
    }
    const today = toISODate(new Date());
    const rows = await db.prepare(
        `SELECT s.id as session_id, s.date, s.class_id, c.name as class_name, s.topic,
         (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) as attendance_count,
         CASE WHEN EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id AND tc.teacher_id = ?)
           THEN 1 ELSE 0 END as checked_in
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.date = ? AND c.teacher_id = ?
       ORDER BY s.id ASC`
      )
      .all(tid, today, tid) as {
      session_id: number;
      date: string;
      class_id: number;
      class_name: string;
      topic: string | null;
      attendance_count: number;
      checked_in: number;
    }[];
    res.json(rows.map((r) => ({ ...r, checked_in: r.checked_in === 1 })));
  })
);

/** Giáo viên điểm danh bằng mã check-in của buổi học */
router.post(
  '/checkin',
  requirePermission('attendance.take'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = req.user?.teacher_id;
    if (!tid) {
      res.status(400).json({ error: 'Tài khoản chưa gắn với giáo viên nào' });
      return;
    }
    const { code } = req.body as { code?: string };
    if (!code) {
      res.status(400).json({ error: 'Vui lòng nhập mã điểm danh' });
      return;
    }
    const today = toISODate(new Date());
    const sess = await db.prepare(
        `SELECT s.id as session_id, s.date, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.checkin_code = ? AND s.checkin_date = ? AND c.teacher_id = ?`
      )
      .get(String(code).trim(), today, tid) as
      { session_id: number; date: string; class_name: string } | undefined;
    if (!sess) {
      res.status(400).json({ error: 'Mã điểm danh không hợp lệ hoặc đã hết hạn' });
      return;
    }
    await db.prepare('INSERT OR IGNORE INTO teacher_checkins (session_id, teacher_id) VALUES (?, ?)').run(
      sess.session_id,
      tid
    );
    res.json({ ok: true, session_id: sess.session_id, class_name: sess.class_name, date: sess.date });
  })
);

/** Bảng lương của chính giáo viên */
router.get(
  '/payroll',
  requirePermission('payroll.view_self'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = effTeacherId(req);
    if (!tid) {
      res.status(400).json({ error: 'Tài khoản chưa gắn với giáo viên nào' });
      return;
    }
    const q = String((req.query as { month?: string }).month || '');
    const month = MONTH_RE.test(q) ? q : currentMonth();
    res.json({ month, ...calcPayroll(tid, month) });
  })
);

export default router;
