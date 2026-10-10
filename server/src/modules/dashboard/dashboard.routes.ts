import { Router, Response } from 'express';
import { db, toISODate, formatSchedule } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { getPermissionScope } from '../authorization/authorization.service';
import { asyncHandler } from '../../shared/http';

const router = Router();

/**
 * Đầu tháng hiện tại và đầu tháng sau, dạng 'YYYY-MM-DD'.
 * Dùng so sánh range trên paid_at (text ISO 'YYYY-MM-DD HH24:MI:SS', thứ tự chuỗi
 * = thứ tự thời gian) thay cho substr(paid_at,1,7) — planner dùng được index btree.
 */
export function monthRange(today: string): [string, string] {
  const monthStart = today.slice(0, 7) + '-01';
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [monthStart, next];
}

router.get(
  '/',
  requirePermission('reports.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const today = toISODate(new Date());
    const [monthStart, nextMonthStart] = monthRange(today);
    const cid = reqCenterId(req);

    // Điều kiện lọc theo trung tâm (superadmin: không lọc)
    const cStudents = cid ? 'WHERE center_id = ?' : '';
    const cTeachers = cid ? 'WHERE center_id = ?' : '';
    const p = (v: number | null) => (v === null ? [] : [v]);

    // 7 query độc lập — chạy song song để giảm latency (trước đây await nối tiếp)
    const [
      totalStudents,
      studyingStudents,
      totalTeachers,
      activeClasses,
      revenueThisMonth,
      unpaidTotal,
      todaySessions,
    ] = await Promise.all([
      db
        .prepare(`SELECT COUNT(*) as c FROM students ${cStudents}`)
        .get(...p(cid))
        .then((r) => (r as { c: number }).c),
      db
        .prepare(
          `SELECT COUNT(*) as c FROM students ${cid ? 'WHERE center_id = ? AND' : 'WHERE'} status = 'studying'`
        )
        .get(...p(cid))
        .then((r) => (r as { c: number }).c),
      db
        .prepare(`SELECT COUNT(*) as c FROM teachers ${cTeachers}`)
        .get(...p(cid))
        .then((r) => (r as { c: number }).c),
      db
        .prepare(
          `SELECT COUNT(*) as c FROM classes ${cid ? 'WHERE center_id = ? AND' : 'WHERE'} status = 'active'`
        )
        .get(...p(cid))
        .then((r) => (r as { c: number }).c),
      db
        .prepare(
          `SELECT COALESCE(SUM(p.amount),0) as s FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN students s ON s.id = i.student_id
         WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status = 'confirmed' ${cid ? 'AND s.center_id = ?' : ''}`
        )
        .get(monthStart, nextMonthStart, ...p(cid))
        .then((r) => (r as { s: number }).s),
      db
        .prepare(
          `SELECT COALESCE(SUM(i.amount - COALESCE(pp.paid,0)),0) as s
         FROM invoices i JOIN students s ON s.id = i.student_id
         LEFT JOIN (SELECT invoice_id, SUM(amount) as paid FROM payments WHERE status = 'confirmed' GROUP BY invoice_id) pp ON pp.invoice_id = i.id
         WHERE i.status != 'paid' ${cid ? 'AND s.center_id = ?' : ''}`
        )
        .get(...p(cid))
        .then((r) => (r as { s: number }).s),
      db
        .prepare(
          `SELECT s.id, s.date, s.topic, c.id as class_id, c.name as class_name, c.schedule, t.name as teacher_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       LEFT JOIN teachers t ON t.id = c.teacher_id
       WHERE s.date = ? ${cid ? 'AND c.center_id = ?' : ''} ORDER BY c.name`
        )
        .all(today, ...p(cid)) as Promise<
        {
          id: number;
          date: string;
          topic: string | null;
          class_id: number;
          class_name: string;
          schedule: string;
          teacher_name: string | null;
        }[]
      >,
    ]);

    const scope = await getPermissionScope(req.user!.id, 'reports.view');
    // Scope 'own' (giáo viên hoặc custom role) không xem tài chính trung tâm
    const hideFinance = scope === 'own';
    res.json({
      totalStudents,
      studyingStudents,
      totalTeachers,
      activeClasses,
      // Scope 'own' không xem tài chính trung tâm
      revenueThisMonth: hideFinance ? 0 : revenueThisMonth,
      unpaidTotal: hideFinance ? 0 : unpaidTotal,
      todaySessions: todaySessions.map((s) => ({ ...s, scheduleText: formatSchedule(s.schedule) })),
    });
  })
);

export default router;
