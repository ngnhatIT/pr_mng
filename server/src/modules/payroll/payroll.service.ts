import { db, toISODate } from '../../db';
import { AppError } from '../../shared/errors';

/** Định dạng tháng YYYY-MM */
export const MONTH_RE = /^\d{4}-\d{2}$/;

/** Validate tháng có thật (không chỉ đúng format). */
export function assertValidMonth(month: string): void {
  if (!MONTH_RE.test(month)) {
    throw AppError.badRequest('Tháng không hợp lệ (YYYY-MM)');
  }
  const mo = Number(month.slice(5, 7));
  if (mo < 1 || mo > 12) {
    throw AppError.badRequest('Tháng không tồn tại (01-12)');
  }
}

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
  const row = (await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sessions s
            JOIN classes c ON c.id = s.class_id
          WHERE c.teacher_id = ?
            AND substr(s.date, 1, 7) = ?
            AND (EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
                 OR EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id))) as sessions,
         COALESCE((SELECT per_session_amount FROM salary_rules sr WHERE sr.teacher_id = ?), 0) as per_session`
    )
    .get(teacherId, month, teacherId)) as { sessions: number; per_session: number };
  const sessions = row.sessions || 0;
  const perSession = row.per_session || 0;
  return { sessions, per_session: perSession, total: sessions * perSession };
}

export interface PayrollRow {
  teacher_id: number;
  teacher_name: string;
  sessions: number;
  per_session: number;
  total: number;
}

/**
 * Bảng lương cả trung tâm trong 1 query duy nhất (GROUP BY teacher_id).
 * Thay thế pattern 1 + N query (N = số giáo viên).
 */
export async function calcPayrollBulk(centerId: number | null, month: string): Promise<PayrollRow[]> {
  const rows = (await db
    .prepare(
      `SELECT t.id as teacher_id, t.name as teacher_name,
         COUNT(DISTINCT CASE WHEN s.id IS NOT NULL THEN s.id END) as sessions,
         COALESCE(sr.per_session_amount, 0) as per_session
       FROM teachers t
       LEFT JOIN classes c ON c.teacher_id = t.id
       LEFT JOIN sessions s ON s.class_id = c.id
         AND substr(s.date, 1, 7) = ?
         AND (EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
              OR EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id))
       LEFT JOIN salary_rules sr ON sr.teacher_id = t.id
       ${centerId !== null ? 'WHERE t.center_id = ?' : ''}
       GROUP BY t.id, t.name, sr.per_session_amount
       ORDER BY t.name`
    )
    .all(month, ...(centerId !== null ? [centerId] : []))) as {
    teacher_id: number;
    teacher_name: string;
    sessions: number;
    per_session: number;
  }[];
  return rows.map((r) => ({
    teacher_id: r.teacher_id,
    teacher_name: r.teacher_name,
    sessions: Number(r.sessions) || 0,
    per_session: Number(r.per_session) || 0,
    total: (Number(r.sessions) || 0) * (Number(r.per_session) || 0),
  }));
}
