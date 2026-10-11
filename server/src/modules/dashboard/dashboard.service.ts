import { db, toISODate, formatSchedule } from '../../db';
import { confirmedPaidJoin } from '../invoices/invoices.service';

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

/**
 * Số liệu dashboard. cid null = superadmin (toàn hệ thống). tid != null = scope 'own'
 * (chỉ lớp mình dạy; tid 0 = chưa gắn giáo viên -> không thấy gì, fail-closed).
 * own = không xem tài chính.
 */
export async function getDashboard(cid: number | null, tid: number | null, own: boolean) {
  const today = toISODate(new Date());
  const [monthStart, nextMonthStart] = monthRange(today);
  const p = (v: number | null) => (v === null ? [] : [v]);
  // Điều kiện học viên: theo center; scope own -> chỉ học viên đang học (enrollment active) lớp mình dạy
  const stuWhere = [
    ...(cid !== null ? ['center_id = ?'] : []),
    ...(tid !== null
      ? [
          `id IN (SELECT e.student_id FROM enrollments e JOIN classes c ON c.id = e.class_id
             WHERE e.status = 'active' AND c.teacher_id = ?)`,
        ]
      : []),
  ];
  const stuParams = [...p(cid), ...p(tid)];
  const clsWhere = [
    "status = 'active'",
    ...(cid !== null ? ['center_id = ?'] : []),
    ...(tid !== null ? ['teacher_id = ?'] : []),
  ].join(' AND ');
  const where = (conds: string[]) => (conds.length ? `WHERE ${conds.join(' AND ')}` : '');

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
      .prepare(`SELECT COUNT(*) as c FROM students ${where(stuWhere)}`)
      .get(...stuParams)
      .then((r) => Number((r as { c: number }).c)),
    db
      .prepare(`SELECT COUNT(*) as c FROM students ${where([...stuWhere, "status = 'studying'"])}`)
      .get(...stuParams)
      .then((r) => Number((r as { c: number }).c)),
    tid !== null
      ? Promise.resolve(tid ? 1 : 0)
      : db
          .prepare(`SELECT COUNT(*) as c FROM teachers ${cid !== null ? 'WHERE center_id = ?' : ''}`)
          .get(...p(cid))
          .then((r) => Number((r as { c: number }).c)),
    db
      .prepare(`SELECT COUNT(*) as c FROM classes WHERE ${clsWhere}`)
      .get(...p(cid), ...p(tid))
      .then((r) => Number((r as { c: number }).c)),
    own
      ? Promise.resolve(0)
      : db
          .prepare(
            `SELECT COALESCE(SUM(p.amount),0) as s FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN students s ON s.id = i.student_id
       WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status = 'confirmed' ${cid !== null ? 'AND s.center_id = ?' : ''}`
          )
          .get(monthStart, nextMonthStart, ...p(cid))
          .then((r) => (r as { s: number }).s),
    own
      ? Promise.resolve(0)
      : db
          .prepare(
            `SELECT COALESCE(SUM(i.amount - COALESCE(pp.paid,0)),0) as s
       FROM invoices i JOIN students s ON s.id = i.student_id
       ${confirmedPaidJoin}
       WHERE i.status != 'paid' ${cid !== null ? 'AND s.center_id = ?' : ''}`
          )
          .get(...p(cid))
          .then((r) => (r as { s: number }).s),
    db
      .prepare(
        `SELECT s.id, s.date, s.topic, c.id as class_id, c.name as class_name, c.schedule, t.name as teacher_name
     FROM sessions s JOIN classes c ON c.id = s.class_id
     LEFT JOIN teachers t ON t.id = COALESCE(s.teacher_id, c.teacher_id)
     WHERE s.date = ? AND s.status <> 'cancelled' ${cid !== null ? 'AND c.center_id = ?' : ''}
       ${tid !== null ? 'AND COALESCE(s.teacher_id, c.teacher_id) = ?' : ''} ORDER BY c.name`
      )
      .all(today, ...p(cid), ...p(tid)) as Promise<
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

  return {
    totalStudents,
    studyingStudents,
    totalTeachers,
    activeClasses,
    // Scope 'own' không xem tài chính trung tâm
    revenueThisMonth,
    unpaidTotal,
    todaySessions: todaySessions.map((s) => ({ ...s, scheduleText: formatSchedule(s.schedule) })),
  };
}
