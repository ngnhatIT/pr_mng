import { db, toISODate } from '../../db';

/** Định dạng tháng YYYY-MM */
export const MONTH_RE = /^\d{4}-\d{2}$/;

export interface PayrollResult {
  sessions: number;
  per_session: number;
  total: number;
}

/** Tháng hiện tại (YYYY-MM) */
export function currentMonth(): string {
  return toISODate(new Date()).slice(0, 7);
}

/**
 * Tính lương 1 giáo viên trong tháng:
 * số buổi đã điểm danh/check-in × đơn giá buổi dạy.
 */
export async function calcPayroll(teacherId: number, month: string): Promise<PayrollResult> {
  const row = await db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM sessions s
            JOIN classes c ON c.id = s.class_id
          WHERE c.teacher_id = ?
            AND substr(s.date, 1, 7) = ?
            AND (EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
                 OR EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id))) as sessions,
         COALESCE((SELECT per_session_amount FROM salary_rules sr WHERE sr.teacher_id = ?), 0) as per_session`
    )
    .get(teacherId, month, teacherId) as { sessions: number; per_session: number };
  const sessions = row.sessions || 0;
  const perSession = row.per_session || 0;
  return { sessions, per_session: perSession, total: sessions * perSession };
}
