import crypto from 'crypto';
import type { ScopeCtx } from '../../shared/scope';
import { db, toISODate, addDays } from '../../db';
import { notifyParents } from '../../services/notify';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { logger } from '../../shared/logger';
import { assertPayrollMonthOpen } from '../payroll/payroll.service';

const log = logger.scope('sessions');

/* ---------------------------------- Types ---------------------------------- */

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export const ATTENDANCE_STATUS = ['present', 'absent', 'late'] as const;

export interface SessionInput {
  class_id: number;
  date: string;
  topic?: string;
}

export interface AttendanceRecord {
  student_id: number;
  status: string;
  note?: string;
}

interface SessionClass {
  session_id: number;
  class_id: number;
  date: string;
  topic: string | null;
  status: string;
  center_id: number | null;
  teacher_id: number | null;
  class_name: string;
}

interface ClassScope {
  id: number;
  center_id: number | null;
  teacher_id: number | null;
}

/** Cột trả cho client: KHÔNG có checkin_code/checkin_date (giáo viên đọc được mã thì tự check-in từ xa). */
const SESSION_COLS = 's.id, s.class_id, s.date, s.topic, s.status, s.teacher_id';

/** Scope 'own' chỉ điểm danh trong vòng N ngày gần đây (chống điểm danh hồi tố để tăng lương). */
export const OWN_ATTENDANCE_MAX_AGE_DAYS = 7;

/* ------------------------------ Scope & validate ------------------------------ */

/** Lấy thông tin lớp của 1 buổi học (để kiểm tra scope). */
async function getSessionClass(sessionId: number): Promise<SessionClass | undefined> {
  return (await db
    .prepare(
      `SELECT s.id as session_id, s.class_id, s.date, s.topic, s.status, c.center_id, c.teacher_id, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.id = ?`
    )
    .get(sessionId)) as SessionClass | undefined;
}

/** Lớp phải thuộc center của user (superadmin bypass); scope 'own' chỉ lớp do mình dạy (fail-closed). */
function inScope(ctx: ScopeCtx, cls: { center_id: number | null; teacher_id: number | null }): boolean {
  if (ctx.centerId !== null && cls.center_id !== ctx.centerId) return false;
  if (ctx.ownOnly && (!ctx.teacherId || cls.teacher_id !== ctx.teacherId)) return false;
  return true;
}

/** Lấy buổi học (chưa hủy) trong scope — ném 404 nếu không thấy (tránh lộ dữ liệu center khác). */
async function getSessionOr404(ctx: ScopeCtx, id: number): Promise<SessionClass> {
  const sc = await getSessionClass(id);
  if (!sc || sc.status === 'cancelled' || !inScope(ctx, sc))
    throw AppError.notFound('Không tìm thấy buổi học');
  return sc;
}

/** Lấy lớp trong scope — ném 404 nếu không thấy. */
async function getClassOr404(ctx: ScopeCtx, classId: number): Promise<ClassScope> {
  const cls = (await db
    .prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?')
    .get(classId)) as ClassScope | undefined;
  if (!cls || !inScope(ctx, cls)) throw AppError.notFound('Không tìm thấy lớp học');
  return cls;
}

/**
 * Giới hạn ngày được điểm danh/check-in: không cho buổi trong tương lai (giờ VN);
 * scope 'own' thêm: không cũ hơn OWN_ATTENDANCE_MAX_AGE_DAYS ngày.
 */
export function assertAttendanceDate(date: string, ownOnly: boolean, now = new Date()): void {
  const today = toISODate(now);
  if (date > today) throw AppError.badRequest('Chưa đến ngày học, không thể điểm danh buổi trong tương lai');
  if (ownOnly && date < toISODate(addDays(now, -OWN_ATTENDANCE_MAX_AGE_DAYS))) {
    throw AppError.badRequest(
      `Chỉ được điểm danh trong vòng ${OWN_ATTENDANCE_MAX_AGE_DAYS} ngày, liên hệ giáo vụ để sửa buổi cũ hơn`
    );
  }
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách buổi học của lớp (chỉ đọc — buổi được sinh khi tạo/sửa lớp và job hằng ngày). */
export async function listClassSessions(ctx: ScopeCtx, classId: number): Promise<unknown[]> {
  await getClassOr404(ctx, classId);
  return (await db
    .prepare(
      `SELECT ${SESSION_COLS}, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) as attendance_count
       FROM sessions s WHERE s.class_id = ? AND s.status <> 'cancelled' ORDER BY s.date ASC`
    )
    .all(classId)) as unknown[];
}

/** Tạo buổi học thủ công (buổi bù). Ngày đã bị hủy trước đó thì khôi phục lại. */
export async function createSession(ctx: ScopeCtx, input: SessionInput): Promise<unknown> {
  if (!input.class_id || !input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw AppError.badRequest('Thiếu lớp học hoặc ngày không hợp lệ (YYYY-MM-DD)');
  }
  const cls = await getClassOr404(ctx, Number(input.class_id));
  const row = (await db
    .prepare(
      `INSERT INTO sessions (class_id, date, topic, teacher_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (class_id, date) DO UPDATE
         SET status = 'scheduled', topic = excluded.topic, teacher_id = excluded.teacher_id
         WHERE sessions.status = 'cancelled'
       RETURNING id`
    )
    .get(cls.id, input.date, input.topic || '', cls.teacher_id)) as { id: number } | undefined;
  if (!row) throw AppError.badRequest('Buổi học ngày này đã tồn tại');
  return await db.prepare(`SELECT ${SESSION_COLS} FROM sessions s WHERE s.id = ?`).get(row.id);
}

/** Cập nhật chủ đề buổi học. */
export async function updateSessionTopic(ctx: ScopeCtx, id: number, topic?: string): Promise<unknown> {
  await getSessionOr404(ctx, id);
  await db.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topic || '', id);
  return await db.prepare(`SELECT ${SESSION_COLS} FROM sessions s WHERE s.id = ?`).get(id);
}

/**
 * Hủy buổi học (soft-cancel status='cancelled'): giữ row để việc sinh lịch không "hồi sinh" ngày đã hủy.
 * Điểm danh + check-in của buổi bị xóa như trước (transaction + audit vì ảnh hưởng lương giáo viên).
 */
export async function deleteSession(ctx: ScopeCtx, id: number, actor?: AuditActor): Promise<void> {
  const sc = await getSessionOr404(ctx, id);
  await assertPayrollMonthOpen(sc.center_id, sc.date); // J-A8
  const attendanceCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM attendance WHERE session_id = ?').get(id)) as { c: number }
  ).c;
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM attendance WHERE session_id = ?').run(id);
    await tx.prepare('DELETE FROM teacher_checkins WHERE session_id = ?').run(id);
    await tx
      .prepare(
        "UPDATE sessions SET status = 'cancelled', checkin_code = NULL, checkin_date = NULL WHERE id = ?"
      )
      .run(id);
  });
  await audit({
    centerId: sc.center_id,
    actor,
    action: 'delete',
    entity: 'sessions',
    entityId: id,
    summary: `Hủy buổi học ngày ${sc.date} (lớp ${sc.class_name}, kèm ${attendanceCount} bản ghi điểm danh)`,
    meta: { class_id: sc.class_id, date: sc.date, attendance_count: attendanceCount },
  });
}

/** Lấy điểm danh của buổi học (kèm danh sách học viên của lớp). */
export async function getSessionAttendance(ctx: ScopeCtx, id: number): Promise<Record<string, unknown>> {
  const sc = await getSessionOr404(ctx, id);
  const sess = await db.prepare(`SELECT ${SESSION_COLS} FROM sessions s WHERE s.id = ?`).get(id);
  const students = await db
    .prepare(
      `SELECT s.id, s.code, s.name, a.status, a.note
       FROM enrollments e JOIN students s ON s.id = e.student_id
       LEFT JOIN attendance a ON a.session_id = ? AND a.student_id = s.id
       WHERE e.class_id = ? AND e.status = 'active' ORDER BY s.name`
    )
    .all(id, sc.class_id);
  return { session: sess, students };
}

/** Lưu điểm danh (upsert).
 * - Chỉ nhận student_id có enrollment active trong lớp (chống điểm danh "ma").
 * - Chỉ thông báo vắng khi học viên CHUYỂN SANG absent lần đầu (không spam khi lưu lại). */
export async function saveAttendance(
  ctx: ScopeCtx,
  id: number,
  records: AttendanceRecord[]
): Promise<{ saved: number; date: string }> {
  if (!Array.isArray(records)) throw AppError.badRequest('Dữ liệu điểm danh không hợp lệ');
  const sc = await getSessionOr404(ctx, id);
  assertAttendanceDate(sc.date, !!ctx.ownOnly);
  await assertPayrollMonthOpen(sc.center_id, sc.date); // J-A8
  const valid = records.filter(
    (r) => r && r.student_id && (ATTENDANCE_STATUS as readonly string[]).includes(r.status)
  );
  if (!valid.length) return { saved: 0, date: sc.date };
  // Whitelist: chỉ học viên đang học lớp này
  const enrolledRows = (await db
    .prepare("SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'")
    .all(sc.class_id)) as { student_id: number }[];
  const enrolled = new Set(enrolledRows.map((r) => r.student_id));
  const accepted = valid.filter((r) => enrolled.has(Number(r.student_id)));
  if (!accepted.length) throw AppError.badRequest('Không có học viên hợp lệ để điểm danh');
  // Trạng thái cũ để chỉ notify khi chuyển sang absent lần đầu
  const prevRows = (await db
    .prepare('SELECT student_id, status FROM attendance WHERE session_id = ?')
    .all(id)) as { student_id: number; status: string }[];
  const prev = new Map(prevRows.map((r) => [r.student_id, r.status]));
  await db.transaction(async (tx) => {
    const upsert = await tx.prepare(
      `INSERT INTO attendance (session_id, student_id, status, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note`
    );
    for (const r of accepted) {
      await upsert.run(id, r.student_id, r.status, r.note || null);
    }
  });
  // Thông báo phụ huynh cho các học viên VỪA chuyển sang vắng mặt
  const nameStmt = await db.prepare('SELECT name FROM students WHERE id = ?');
  for (const r of accepted) {
    if (r.status === 'absent' && prev.get(Number(r.student_id)) !== 'absent') {
      const st = (await nameStmt.get(r.student_id)) as { name: string } | undefined;
      notifyParents(
        r.student_id,
        'absence',
        `Học viên ${st?.name || ''} vắng mặt buổi học ngày ${sc.date} — lớp ${sc.class_name}.`,
        null
      ).catch((err) => log.warn('notifyParents failed', { error: String(err) }));
    }
  }
  return { saved: accepted.length, date: sc.date };
}

/** Sinh mã điểm danh 6 số cho buổi học (staff) — dùng crypto CSPRNG. */
export async function generateCheckinCode(ctx: ScopeCtx, id: number): Promise<{ code: string }> {
  await getSessionOr404(ctx, id);
  const today = toISODate(new Date());
  // Thử tối đa 10 lần để tránh trùng mã với buổi khác cùng ngày
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(crypto.randomInt(100000, 1000000));
    const clash = (await db
      .prepare(
        `SELECT 1 FROM sessions
         WHERE checkin_date = ? AND checkin_code = ? AND id != ? LIMIT 1`
      )
      .get(today, code, id)) as { '1'?: number } | undefined;
    if (!clash) {
      try {
        await db
          .prepare('UPDATE sessions SET checkin_code = ?, checkin_date = ? WHERE id = ?')
          .run(code, today, id);
        return { code };
      } catch (err) {
        // Race: 2 request cùng sinh mã giống nhau, UNIQUE constraint chặn → thử mã khác
        if ((err as { code?: string }).code === '23505') continue;
        throw err;
      }
    }
  }
  throw AppError.conflict('Không sinh được mã điểm danh duy nhất, vui lòng thử lại');
}
