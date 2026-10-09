import crypto from 'crypto';
import { db, generateSessionsForClass, toISODate } from '../../db';
import { notifyParents } from '../../services/notify';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { logger } from '../../shared/logger';

const log = logger.scope('sessions');

/* ---------------------------------- Types ---------------------------------- */

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface ScopeCtx {
  centerId: number | null; // null = superadmin (thấy mọi trung tâm)
  role: string;
  teacherId: number | null;
}

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
  center_id: number | null;
  teacher_id: number | null;
  class_name: string;
}

interface ClassScope {
  id: number;
  center_id: number | null;
  teacher_id: number | null;
}

/* ------------------------------ Scope & validate ------------------------------ */

/** Lấy thông tin lớp của 1 buổi học (để kiểm tra scope). */
async function getSessionClass(sessionId: number): Promise<SessionClass | undefined> {
  return (await db
    .prepare(
      `SELECT s.id as session_id, s.class_id, s.date, s.topic, c.center_id, c.teacher_id, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.id = ?`
    )
    .get(sessionId)) as SessionClass | undefined;
}

/**
 * Kiểm tra scope: lớp của buổi học phải thuộc center của user (superadmin bypass);
 * role teacher chỉ được thao tác lớp do mình dạy.
 */
function checkScope(ctx: ScopeCtx, sc: SessionClass): boolean {
  if (ctx.centerId !== null && sc.center_id !== ctx.centerId) return false;
  if (ctx.role === 'teacher') {
    if (!ctx.teacherId || sc.teacher_id !== ctx.teacherId) return false;
  }
  return true;
}

async function getClassScope(ctx: ScopeCtx, classId: number): Promise<ClassScope | null> {
  const cls = (await db
    .prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?')
    .get(classId)) as ClassScope | undefined;
  if (!cls) return null;
  if (ctx.centerId !== null && cls.center_id !== ctx.centerId) return null;
  if (ctx.role === 'teacher' && (!ctx.teacherId || cls.teacher_id !== ctx.teacherId)) {
    return null;
  }
  return cls;
}

/** Lấy buổi học trong scope — ném 404 nếu không thấy (tránh lộ dữ liệu center khác). */
async function getSessionOr404(ctx: ScopeCtx, id: number): Promise<SessionClass> {
  const sc = await getSessionClass(id);
  if (!sc || !checkScope(ctx, sc)) throw AppError.notFound('Không tìm thấy buổi học');
  return sc;
}

/** Lấy lớp trong scope — ném 404 nếu không thấy. */
async function getClassOr404(ctx: ScopeCtx, classId: number): Promise<ClassScope> {
  const cls = await getClassScope(ctx, classId);
  if (!cls) throw AppError.notFound('Không tìm thấy lớp học');
  return cls;
}

/* --------------------------------- Service --------------------------------- */

/** Lấy danh sách buổi học của lớp (tự sinh từ lịch nếu chưa có). */
export async function listClassSessions(ctx: ScopeCtx, classId: number): Promise<unknown[]> {
  await getClassOr404(ctx, classId);
  await generateSessionsForClass(classId);
  return (await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) as attendance_count
       FROM sessions s WHERE s.class_id = ? ORDER BY s.date ASC`
    )
    .all(classId)) as unknown[];
}

/** Tạo buổi học thủ công. */
export async function createSession(ctx: ScopeCtx, input: SessionInput): Promise<unknown> {
  if (!input.class_id || !input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw AppError.badRequest('Thiếu lớp học hoặc ngày không hợp lệ (YYYY-MM-DD)');
  }
  await getClassOr404(ctx, Number(input.class_id));
  const r = await db
    .prepare('INSERT OR IGNORE INTO sessions (class_id, date, topic) VALUES (?, ?, ?)')
    .run(input.class_id, input.date, input.topic || '');
  if (r.changes === 0) throw AppError.badRequest('Buổi học ngày này đã tồn tại');
  return await db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(r.lastInsertRowid));
}

/** Cập nhật chủ đề buổi học. */
export async function updateSessionTopic(ctx: ScopeCtx, id: number, topic?: string): Promise<unknown> {
  await getSessionOr404(ctx, id);
  await db.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topic || '', id);
  return await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

/** Xóa buổi học + điểm danh liên quan (transaction + audit vì ảnh hưởng lương giáo viên). */
export async function deleteSession(ctx: ScopeCtx, id: number, actor?: AuditActor): Promise<void> {
  const sc = await getSessionOr404(ctx, id);
  const attendanceCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM attendance WHERE session_id = ?').get(id)) as { c: number }
  ).c;
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM attendance WHERE session_id = ?').run(id);
    await tx.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  });
  await audit({
    centerId: sc.center_id,
    actor,
    action: 'delete',
    entity: 'sessions',
    entityId: id,
    summary: `Xóa buổi học ngày ${sc.date} (lớp ${sc.class_name}, kèm ${attendanceCount} bản ghi điểm danh)`,
    meta: { class_id: sc.class_id, date: sc.date, attendance_count: attendanceCount },
  });
}

/** Lấy điểm danh của buổi học (kèm danh sách học viên của lớp). */
export async function getSessionAttendance(ctx: ScopeCtx, id: number): Promise<Record<string, unknown>> {
  const sc = await getSessionOr404(ctx, id);
  const sess = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
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
      await db.prepare('UPDATE sessions SET checkin_code = ?, checkin_date = ? WHERE id = ?').run(code, today, id);
      return { code };
    }
  }
  throw AppError.conflict('Không sinh được mã điểm danh duy nhất, vui lòng thử lại');
}
