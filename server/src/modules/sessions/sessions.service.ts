import { db, generateSessionsForClass, toISODate } from '../../db';
import { notifyParents } from '../../services/notify';
import { AppError } from '../../shared/errors';

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
function getSessionClass(sessionId: number): SessionClass | undefined {
  return db
    .prepare(
      `SELECT s.id as session_id, s.class_id, s.date, s.topic, c.center_id, c.teacher_id, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       WHERE s.id = ?`
    )
    .get(sessionId) as SessionClass | undefined;
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

function getClassScope(ctx: ScopeCtx, classId: number): ClassScope | null {
  const cls = db.prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?').get(classId) as
    ClassScope | undefined;
  if (!cls) return null;
  if (ctx.centerId !== null && cls.center_id !== ctx.centerId) return null;
  if (ctx.role === 'teacher' && (!ctx.teacherId || cls.teacher_id !== ctx.teacherId)) {
    return null;
  }
  return cls;
}

/** Lấy buổi học trong scope — ném 404 nếu không thấy (tránh lộ dữ liệu center khác). */
function getSessionOr404(ctx: ScopeCtx, id: number): SessionClass {
  const sc = getSessionClass(id);
  if (!sc || !checkScope(ctx, sc)) throw AppError.notFound('Không tìm thấy buổi học');
  return sc;
}

/** Lấy lớp trong scope — ném 404 nếu không thấy. */
function getClassOr404(ctx: ScopeCtx, classId: number): ClassScope {
  const cls = getClassScope(ctx, classId);
  if (!cls) throw AppError.notFound('Không tìm thấy lớp học');
  return cls;
}

/* --------------------------------- Service --------------------------------- */

/** Lấy danh sách buổi học của lớp (tự sinh từ lịch nếu chưa có). */
export function listClassSessions(ctx: ScopeCtx, classId: number): unknown[] {
  getClassOr404(ctx, classId);
  generateSessionsForClass(classId);
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) as attendance_count
       FROM sessions s WHERE s.class_id = ? ORDER BY s.date ASC`
    )
    .all(classId) as unknown[];
}

/** Tạo buổi học thủ công. */
export function createSession(ctx: ScopeCtx, input: SessionInput): unknown {
  if (!input.class_id || !input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw AppError.badRequest('Thiếu lớp học hoặc ngày không hợp lệ (YYYY-MM-DD)');
  }
  getClassOr404(ctx, Number(input.class_id));
  const r = db
    .prepare('INSERT OR IGNORE INTO sessions (class_id, date, topic) VALUES (?, ?, ?)')
    .run(input.class_id, input.date, input.topic || '');
  if (r.changes === 0) throw AppError.badRequest('Buổi học ngày này đã tồn tại');
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(r.lastInsertRowid));
}

/** Cập nhật chủ đề buổi học. */
export function updateSessionTopic(ctx: ScopeCtx, id: number, topic?: string): unknown {
  getSessionOr404(ctx, id);
  db.prepare('UPDATE sessions SET topic = ? WHERE id = ?').run(topic || '', id);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

/** Xóa buổi học + điểm danh liên quan. */
export function deleteSession(ctx: ScopeCtx, id: number): void {
  getSessionOr404(ctx, id);
  db.prepare('DELETE FROM attendance WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

/** Lấy điểm danh của buổi học (kèm danh sách học viên của lớp). */
export function getSessionAttendance(ctx: ScopeCtx, id: number): Record<string, unknown> {
  const sc = getSessionOr404(ctx, id);
  const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  const students = db
    .prepare(
      `SELECT s.id, s.code, s.name, a.status, a.note
       FROM enrollments e JOIN students s ON s.id = e.student_id
       LEFT JOIN attendance a ON a.session_id = ? AND a.student_id = s.id
       WHERE e.class_id = ? AND e.status = 'active' ORDER BY s.name`
    )
    .all(id, sc.class_id);
  return { session: sess, students };
}

/** Lưu điểm danh (upsert) — vắng mặt thì thông báo phụ huynh. */
export function saveAttendance(
  ctx: ScopeCtx,
  id: number,
  records: AttendanceRecord[]
): { saved: number; date: string } {
  if (!Array.isArray(records)) throw AppError.badRequest('Dữ liệu điểm danh không hợp lệ');
  const sc = getSessionOr404(ctx, id);
  const valid = records.filter(
    (r) => r.student_id && (ATTENDANCE_STATUS as readonly string[]).includes(r.status)
  );
  const upsert = db.prepare(
    `INSERT INTO attendance (session_id, student_id, status, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note`
  );
  const tx = db.transaction(() => {
    for (const r of valid) {
      upsert.run(id, r.student_id, r.status, r.note || null);
    }
  });
  tx();
  // Thông báo phụ huynh cho các học viên vắng mặt
  const nameStmt = db.prepare('SELECT name FROM students WHERE id = ?');
  for (const r of valid) {
    if (r.status === 'absent') {
      const st = nameStmt.get(r.student_id) as { name: string } | undefined;
      notifyParents(
        r.student_id,
        'absence',
        `Học viên ${st?.name || ''} vắng mặt buổi học ngày ${sc.date} — lớp ${sc.class_name}.`,
        null
      );
    }
  }
  return { saved: valid.length, date: toISODate(new Date()) };
}

/** Sinh mã điểm danh 6 số cho buổi học (staff). */
export function generateCheckinCode(ctx: ScopeCtx, id: number): { code: string } {
  getSessionOr404(ctx, id);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('UPDATE sessions SET checkin_code = ?, checkin_date = ? WHERE id = ?').run(
    code,
    toISODate(new Date()),
    id
  );
  return { code };
}
