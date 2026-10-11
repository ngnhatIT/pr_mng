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
  /** giáo viên thực dạy buổi (dạy thay) */
  session_teacher_id: number | null;
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
      `SELECT s.id as session_id, s.class_id, s.date, s.topic, s.status, c.center_id, c.teacher_id,
         s.teacher_id as session_teacher_id, c.name as class_name
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
  // Scope 'own': giáo viên của lớp HOẶC giáo viên dạy thay buổi này
  const allowed =
    !!sc &&
    (inScope(ctx, sc) || inScope(ctx, { center_id: sc.center_id, teacher_id: sc.session_teacher_id }));
  if (!sc || sc.status === 'cancelled' || !allowed) throw AppError.notFound('Không tìm thấy buổi học');
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
  const attendanceCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM attendance WHERE session_id = ?').get(id)) as { c: number }
  ).c;
  await db.transaction(async (tx) => {
    await assertPayrollMonthOpen(tx, sc.center_id, sc.date); // J-A8
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
    await assertPayrollMonthOpen(tx, sc.center_id, sc.date); // J-A8
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

/* ------------------------------ Lịch (calendar) ------------------------------ */

/** Khoảng tối đa 1 lần đọc lịch (tháng 6 tuần + dư). */
export const CALENDAR_MAX_DAYS = 62;

export interface CalendarItem {
  id: number;
  class_id: number;
  class_name: string;
  date: string;
  start: string | null;
  end: string | null;
  topic: string | null;
  teacher_id: number | null;
  teacher_name: string | null;
  room_id: number | null;
  room_name: string | null;
  /** true khi buổi có giáo viên khác giáo viên của lớp (dạy thay) */
  substitute: boolean;
  rescheduled_from: number | null;
  attendance_count: number;
}

interface CalendarRow extends Omit<CalendarItem, 'start' | 'end' | 'substitute'> {
  schedule: string | null;
  start_time: string | null;
  end_time: string | null;
  class_teacher_id: number | null;
}

/** Giờ thực của buổi: giờ riêng (v26) nếu có, không thì theo lịch tuần của lớp đúng thứ đó. */
export function effectiveTime(
  date: string,
  schedule: string | null,
  start: string | null,
  end: string | null
): { start: string | null; end: string | null } {
  if (start && end) return { start, end };
  let slot: { start?: string; end?: string } | undefined;
  try {
    const js = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dow = js === 0 ? 8 : js + 1; // 2 = T2 ... 8 = CN
    slot = (JSON.parse(schedule || '[]') as { day: number; start: string; end: string }[]).find(
      (x) => Number(x?.day) === dow
    );
  } catch {
    slot = undefined;
  }
  return { start: start ?? slot?.start ?? null, end: end ?? slot?.end ?? null };
}

const CALENDAR_SELECT = `SELECT s.id, s.class_id, c.name AS class_name, s.date, s.topic, s.rescheduled_from,
    s.start_time, s.end_time, c.schedule, c.teacher_id AS class_teacher_id,
    COALESCE(s.teacher_id, c.teacher_id) AS teacher_id, t.name AS teacher_name,
    COALESCE(s.room_id, c.room_id) AS room_id, r.name AS room_name,
    (SELECT COUNT(*)::int FROM attendance a WHERE a.session_id = s.id) AS attendance_count
  FROM sessions s JOIN classes c ON c.id = s.class_id
  LEFT JOIN teachers t ON t.id = COALESCE(s.teacher_id, c.teacher_id)
  LEFT JOIN rooms r ON r.id = COALESCE(s.room_id, c.room_id)`;

function toCalendarItem(r: CalendarRow): CalendarItem {
  const { schedule, start_time, end_time, class_teacher_id, ...rest } = r;
  return {
    ...rest,
    ...effectiveTime(r.date, schedule, start_time, end_time),
    substitute: r.teacher_id !== null && class_teacher_id !== null && r.teacher_id !== class_teacher_id,
  };
}

/**
 * Lịch buổi học trong [from, to] (tối đa CALENDAR_MAX_DAYS ngày), lọc giáo viên/phòng/lớp.
 * Scope 'own': buổi của lớp mình dạy HOẶC buổi mình được phân dạy thay.
 */
export async function listCalendar(
  ctx: ScopeCtx,
  q: { from: string; to: string; teacherId?: number; roomId?: number; classId?: number }
): Promise<CalendarItem[]> {
  if (q.from > q.to) throw AppError.badRequest('Khoảng ngày không hợp lệ', 'INVALID_RANGE');
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
  if (days > CALENDAR_MAX_DAYS) {
    throw AppError.badRequest(`Chỉ xem tối đa ${CALENDAR_MAX_DAYS} ngày mỗi lần`, 'RANGE_TOO_LARGE');
  }
  const conds = ["s.status <> 'cancelled'", 's.date BETWEEN ? AND ?'];
  const params: unknown[] = [q.from, q.to];
  if (ctx.centerId !== null) {
    conds.push('c.center_id = ?');
    params.push(ctx.centerId);
  }
  if (ctx.ownOnly) {
    if (!ctx.teacherId) return [];
    conds.push('(c.teacher_id = ? OR s.teacher_id = ?)');
    params.push(ctx.teacherId, ctx.teacherId);
  }
  if (q.teacherId) {
    conds.push('COALESCE(s.teacher_id, c.teacher_id) = ?');
    params.push(q.teacherId);
  }
  if (q.roomId) {
    conds.push('COALESCE(s.room_id, c.room_id) = ?');
    params.push(q.roomId);
  }
  if (q.classId) {
    conds.push('s.class_id = ?');
    params.push(q.classId);
  }
  const rows = (await db
    .prepare(`${CALENDAR_SELECT} WHERE ${conds.join(' AND ')} ORDER BY s.date, c.name`)
    .all(...params)) as CalendarRow[];
  return rows
    .map(toCalendarItem)
    .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
}

async function calendarItem(id: number, q: Pick<typeof db, 'prepare'> = db): Promise<CalendarItem> {
  return toCalendarItem((await q.prepare(`${CALENDAR_SELECT} WHERE s.id = ?`).get(id)) as CalendarRow);
}

/**
 * Trùng lịch của 1 buổi: cùng ngày, giờ giao nhau, cùng giáo viên hoặc cùng phòng (theo giá trị thực).
 * Gọi trong transaction sau khi đã ghi buổi — buổi khác chưa commit được chặn bởi advisory lock theo ngày.
 */
async function assertNoSessionConflict(
  tx: Pick<typeof db, 'prepare'>,
  item: CalendarItem,
  centerId: number | null
) {
  if (!item.start || !item.end) return;
  const others = (await tx
    .prepare(
      `${CALENDAR_SELECT} WHERE s.date = ? AND s.id <> ? AND s.status <> 'cancelled'
       AND c.center_id IS NOT DISTINCT FROM ?`
    )
    .all(item.date, item.id, centerId)) as CalendarRow[];
  for (const o of others.map(toCalendarItem)) {
    if (!o.start || !o.end || !(o.start < item.end && item.start < o.end)) continue;
    if (item.teacher_id && o.teacher_id === item.teacher_id) {
      throw AppError.conflict(
        `Giáo viên ${o.teacher_name ?? ''} đã có buổi lớp "${o.class_name}" ${o.start}-${o.end} cùng ngày`,
        'TEACHER_CONFLICT'
      );
    }
    if (item.room_id && o.room_id === item.room_id) {
      throw AppError.conflict(
        `Phòng ${o.room_name ?? ''} đã có lớp "${o.class_name}" ${o.start}-${o.end} cùng ngày`,
        'ROOM_CONFLICT'
      );
    }
  }
}

/** Giáo viên/phòng phải cùng trung tâm với lớp (chặn gán chéo trung tâm). */
async function assertSameCenter(table: 'teachers' | 'rooms', id: number, centerId: number | null) {
  const row = (await db.prepare(`SELECT center_id FROM ${table} WHERE id = ?`).get(id)) as
    { center_id: number | null } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.badRequest(table === 'teachers' ? 'Giáo viên không hợp lệ' : 'Phòng học không hợp lệ');
  }
}

export interface SessionPatch {
  topic?: string | null;
  /** null = về giáo viên của lớp */
  teacher_id?: number | null;
  /** null = về phòng của lớp */
  room_id?: number | null;
  /** cả hai null = về giờ theo lịch tuần */
  start_time?: string | null;
  end_time?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertTimes(start: string | null | undefined, end: string | null | undefined): void {
  if ((start == null) !== (end == null)) throw AppError.badRequest('Cần cả giờ bắt đầu và giờ kết thúc');
  if (start != null && end != null) {
    if (!HHMM.test(start) || !HHMM.test(end)) throw AppError.badRequest('Giờ phải có dạng HH:MM');
    if (start >= end) throw AppError.badRequest('Giờ kết thúc phải sau giờ bắt đầu');
  }
}

/**
 * Sửa 1 buổi: chủ đề, dạy thay (teacher_id), phòng, giờ riêng. Chỉ trường có trong patch bị đổi.
 * Đổi giáo viên ảnh hưởng lương -> chặn khi tháng lương đã chốt + ghi audit.
 */
export async function updateSessionDetails(
  ctx: ScopeCtx,
  id: number,
  patch: SessionPatch,
  actor?: AuditActor
): Promise<CalendarItem> {
  const sc = await getSessionOr404(ctx, id);
  if ('start_time' in patch || 'end_time' in patch)
    assertTimes(patch.start_time ?? null, patch.end_time ?? null);
  if (patch.teacher_id) await assertSameCenter('teachers', patch.teacher_id, sc.center_id);
  if (patch.room_id) await assertSameCenter('rooms', patch.room_id, sc.center_id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ('topic' in patch) set('topic', patch.topic ?? '');
  if ('teacher_id' in patch) set('teacher_id', patch.teacher_id ?? sc.teacher_id);
  if ('room_id' in patch) set('room_id', patch.room_id ?? null);
  if ('start_time' in patch || 'end_time' in patch) {
    set('start_time', patch.start_time ?? null);
    set('end_time', patch.end_time ?? null);
  }
  if (!sets.length) return calendarItem(id);
  const before = await calendarItem(id);
  const item = await db.transaction(async (tx) => {
    if ('teacher_id' in patch) await assertPayrollMonthOpen(tx, sc.center_id, sc.date); // J-A8
    await tx
      .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
      .get(`session-day:${sc.center_id}:${sc.date}`);
    await tx.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    const after = await calendarItem(id, tx);
    await assertNoSessionConflict(tx, after, sc.center_id);
    return after;
  });
  if (before.teacher_id !== item.teacher_id) {
    await audit({
      centerId: sc.center_id,
      actor,
      action: 'update',
      entity: 'sessions',
      entityId: id,
      summary: `Đổi giáo viên buổi ${sc.date} lớp ${sc.class_name}: ${before.teacher_name ?? '-'} -> ${item.teacher_name ?? '-'}`,
      meta: { from_teacher_id: before.teacher_id, to_teacher_id: item.teacher_id },
    });
  }
  return item;
}

/**
 * Dời buổi sang ngày/giờ khác: hủy mềm buổi gốc (job sinh lịch không tạo lại ngày cũ) + tạo buổi mới
 * trỏ rescheduled_from về buổi gốc. Buổi gốc đã điểm danh thì không dời (tránh mất dữ liệu lương/điểm danh).
 */
export async function rescheduleSession(
  ctx: ScopeCtx,
  id: number,
  input: {
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    room_id?: number | null;
    teacher_id?: number | null;
  },
  actor?: AuditActor
): Promise<CalendarItem> {
  const sc = await getSessionOr404(ctx, id);
  assertTimes(input.start_time ?? null, input.end_time ?? null);
  if (input.teacher_id) await assertSameCenter('teachers', input.teacher_id, sc.center_id);
  if (input.room_id) await assertSameCenter('rooms', input.room_id, sc.center_id);
  if (input.date === sc.date)
    throw AppError.badRequest('Ngày mới trùng ngày cũ — sửa giờ trực tiếp thay vì dời buổi');
  const attended = (await db
    .prepare('SELECT 1 FROM attendance WHERE session_id = ? LIMIT 1')
    .get(id)) as unknown;
  if (attended) throw AppError.conflict('Buổi đã điểm danh, không thể dời', 'SESSION_HAS_ATTENDANCE');
  const old = await calendarItem(id);
  const newId = await db.transaction(async (tx) => {
    await assertPayrollMonthOpen(tx, sc.center_id, sc.date);
    await assertPayrollMonthOpen(tx, sc.center_id, input.date);
    for (const d of [sc.date, input.date].sort()) {
      await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`session-day:${sc.center_id}:${d}`);
    }
    await tx.prepare('DELETE FROM teacher_checkins WHERE session_id = ?').run(id);
    await tx
      .prepare(
        "UPDATE sessions SET status = 'cancelled', checkin_code = NULL, checkin_date = NULL WHERE id = ?"
      )
      .run(id);
    // Giữ giờ cũ khi không chỉ định (dời sang thứ khác vẫn học đúng khung giờ cũ)
    const row = (await tx
      .prepare(
        `INSERT INTO sessions (class_id, date, topic, teacher_id, room_id, start_time, end_time, rescheduled_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (class_id, date) DO UPDATE SET status = 'scheduled', topic = excluded.topic,
           teacher_id = excluded.teacher_id, room_id = excluded.room_id, start_time = excluded.start_time,
           end_time = excluded.end_time, rescheduled_from = excluded.rescheduled_from
           WHERE sessions.status = 'cancelled'
         RETURNING id`
      )
      .get(
        sc.class_id,
        input.date,
        old.topic ?? '',
        input.teacher_id ?? old.teacher_id,
        input.room_id ?? null,
        input.start_time ?? old.start,
        input.end_time ?? old.end,
        id
      )) as { id: number } | undefined;
    if (!row) throw AppError.conflict('Lớp đã có buổi học vào ngày này', 'SESSION_EXISTS');
    await assertNoSessionConflict(tx, await calendarItem(row.id, tx), sc.center_id);
    return row.id;
  });
  await audit({
    centerId: sc.center_id,
    actor,
    action: 'update',
    entity: 'sessions',
    entityId: newId,
    summary: `Dời buổi lớp ${sc.class_name} từ ${sc.date} sang ${input.date}`,
    meta: { from_session_id: id, from_date: sc.date, to_date: input.date },
  });
  return calendarItem(newId);
}
