import { db, toISODate, addDays } from '../../db';
import { OWN_ATTENDANCE_MAX_AGE_DAYS } from '../sessions/sessions.service';
import { AppError } from '../../shared/errors';
import { hasPermission } from '../authorization/authorization.service';
import { calcPayroll, currentMonth, assertValidMonth } from '../payroll/payroll.service';
import type { AuthRequest } from '../../middleware/auth';
import { reqCenterId } from '../../middleware/auth';

export interface TodaySession {
  session_id: number;
  date: string;
  class_id: number;
  class_name: string;
  topic: string | null;
  attendance_count: number;
  checked_in: boolean;
}

/**
 * Lấy teacher_id hiệu lực (giáo viên tự xem; admin có quyền sessions.manage xem hộ qua query).
 * Chặn cross-center: admin chỉ xem được giáo viên cùng trung tâm.
 */
export async function effTeacherId(req: AuthRequest): Promise<number | null> {
  if (req.user?.teacher_id) return req.user.teacher_id;
  const role = req.user?.role;
  if ((role === 'superadmin' || role === 'admin') && req.user?.id) {
    if (await hasPermission(req.user.id, 'sessions.manage')) {
      const q = Number((req.query as { teacher_id?: string }).teacher_id);
      if (!Number.isFinite(q) || q <= 0) return null;
      const cid = reqCenterId(req);
      if (cid !== null) {
        const t = (await db.prepare('SELECT id FROM teachers WHERE id = ? AND center_id = ?').get(q, cid)) as
          { id: number } | undefined;
        if (!t) return null;
      }
      return q;
    }
  }
  return null;
}

/** Các buổi dạy hôm nay của giáo viên. */
export async function getTodaySessions(teacherId: number): Promise<TodaySession[]> {
  const today = toISODate(new Date());
  const rows = (await db
    .prepare(
      `SELECT s.id as session_id, s.date, s.class_id, c.name as class_name, s.topic,
         (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) as attendance_count,
         CASE WHEN EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id AND tc.teacher_id = ?)
           THEN 1 ELSE 0 END as checked_in
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.date = ? AND s.teacher_id = ? AND s.status <> 'cancelled'
       ORDER BY s.id ASC`
    )
    .all(teacherId, today, teacherId)) as {
    session_id: number;
    date: string;
    class_id: number;
    class_name: string;
    topic: string | null;
    attendance_count: number;
    checked_in: number;
  }[];
  return rows.map((r) => ({ ...r, checked_in: r.checked_in === 1 }));
}

/** Giáo viên điểm danh bằng mã check-in của buổi học. */
export async function checkinByCode(
  teacherId: number,
  code: string
): Promise<{ session_id: number; class_name: string; date: string }> {
  if (!code || !String(code).trim()) {
    throw AppError.badRequest('Vui lòng nhập mã điểm danh');
  }
  const today = toISODate(new Date());
  // Mã chỉ hợp lệ trong ngày sinh mã; buổi phải chưa hủy, không ở tương lai và không cũ quá 7 ngày
  const sess = (await db
    .prepare(
      `SELECT s.id as session_id, s.date, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.checkin_code = ? AND s.checkin_date = ? AND (c.teacher_id = ? OR s.teacher_id = ?)
         AND s.status <> 'cancelled' AND s.date <= ? AND s.date >= ?`
    )
    .get(
      String(code).trim(),
      today,
      teacherId,
      teacherId,
      today,
      toISODate(addDays(new Date(), -OWN_ATTENDANCE_MAX_AGE_DAYS))
    )) as { session_id: number; date: string; class_name: string } | undefined;
  if (!sess) {
    throw AppError.badRequest('Mã điểm danh không hợp lệ hoặc đã hết hạn');
  }
  // Check-in xác nhận người dạy thực tế của buổi -> lương tính theo sessions.teacher_id
  await db.transaction(async (tx) => {
    await tx
      .prepare('INSERT INTO teacher_checkins (session_id, teacher_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(sess.session_id, teacherId);
    await tx.prepare('UPDATE sessions SET teacher_id = ? WHERE id = ?').run(teacherId, sess.session_id);
  });
  return sess;
}

/** Bảng lương của giáo viên. */
export async function getMyPayroll(teacherId: number, monthQuery: string) {
  const month = monthQuery ? (assertValidMonth(monthQuery), monthQuery) : currentMonth();
  return { month, ...(await calcPayroll(teacherId, month)) };
}
