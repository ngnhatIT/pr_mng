import { db, ScheduleEntry, DAY_NAMES, toISODate, generateSessionsForClass, scheduleDays } from '../../db';
import type { Tx } from '../../db';
import type { ScopeCtx } from '../../shared/scope';
import { AppError } from '../../shared/errors';
import { homeworkRepo } from '../homework/homework.repo';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, type AuditActor } from '../../shared/audit';
import { escapeLike } from '../../shared/like';

/* ---------------------------------- Types ---------------------------------- */

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface ClassInput {
  name?: string;
  teacher_id?: number | null;
  schedule?: unknown;
  start_date?: string | null;
  end_date?: string | null;
  tuition_fee?: number;
  max_students?: number;
  status?: string;
  room_id?: number | null;
}

export interface ClassRow {
  id: number;
  name: string;
  center_id: number | null;
  teacher_id: number | null;
  max_students: number;
  [key: string]: unknown;
}

/* ------------------------------ Scope & validate ------------------------------ */

type Q = Pick<Tx, 'prepare'>;

/**
 * Điều kiện scope cho bảng classes (alias c):
 * - center: superadmin bypass, còn lại lọc c.center_id
 * - permission scope 'own' (ctx.ownOnly, giáo viên hoặc custom role): chỉ lớp do mình dạy;
 *   chưa gắn teacher_id thì không thấy lớp nào (fail-closed)
 */
export function classScopeWhere(ctx: ScopeCtx): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (ctx.centerId !== null) {
    conds.push('c.center_id = ?');
    params.push(ctx.centerId);
  }
  if (ctx.ownOnly && ctx.teacherId) {
    conds.push('c.teacher_id = ?');
    params.push(ctx.teacherId);
  } else if (ctx.ownOnly) {
    conds.push('1 = 0'); // scope own mà chưa gắn teacher_id thì không thấy lớp nào
  }
  return { clause: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parse & validate lịch học — ném 400 nếu sai định dạng, giờ ngoài 00:00-23:59 hoặc bắt đầu >= kết thúc. */
export function parseSchedule(raw: unknown): ScheduleEntry[] {
  if (!Array.isArray(raw)) throw AppError.badRequest('Lịch học không hợp lệ');
  const value: ScheduleEntry[] = [];
  for (const e of raw) {
    const day = Number((e as ScheduleEntry).day);
    const start = String((e as ScheduleEntry).start || '');
    const end = String((e as ScheduleEntry).end || '');
    if (!Number.isInteger(day) || day < 2 || day > 8) {
      throw AppError.badRequest('Thứ trong lịch học phải từ 2 (Thứ Hai) đến 8 (Chủ Nhật)');
    }
    if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) {
      throw AppError.badRequest('Giờ học phải có dạng HH:MM (00:00-23:59)');
    }
    if (start >= end) {
      throw AppError.badRequest(`Giờ bắt đầu phải trước giờ kết thúc (${DAY_NAMES[day]} ${start}-${end})`);
    }
    value.push({ day, start, end });
  }
  return value;
}

/** Kiểm tra room_id hợp lệ trong scope — trả về id đã chuẩn hóa (hoặc null). */
async function resolveRoomId(roomId: unknown, centerId: number): Promise<number | null> {
  if (roomId === undefined || roomId === null || roomId === '') return null;
  const id = Number(roomId);
  if (!Number.isFinite(id) || id <= 0) throw AppError.badRequest('Phòng học không hợp lệ');
  const room = (await db.prepare('SELECT id, center_id FROM rooms WHERE id = ?').get(id)) as
    { id: number; center_id: number | null } | undefined;
  if (!room) throw AppError.notFound('Không tìm thấy phòng học');
  if (room.center_id !== centerId) throw AppError.badRequest('Phòng học không thuộc trung tâm này');
  return room.id;
}

interface Conflict {
  className: string;
  day: number;
  start: string;
  end: string;
}

/**
 * Tìm lớp active cùng phòng/giáo viên, cùng thứ, khung giờ giao nhau VÀ khoảng ngày học giao nhau.
 * Lớp mới không có start_date coi như bắt đầu hôm nay (lớp cũ đã kết thúc không còn chặn phòng).
 */
async function findConflict(
  q: Q,
  col: 'room_id' | 'teacher_id',
  refId: number,
  schedule: ScheduleEntry[],
  excludeId: number | null,
  centerId: number,
  range: { start: string | null; end: string | null }
): Promise<Conflict | null> {
  if (!refId || schedule.length === 0) return null;
  let sql = `SELECT id, name, schedule FROM classes WHERE ${col} = ? AND status = 'active' AND center_id = ?
    AND (NULLIF(end_date, '') IS NULL OR end_date >= ?)`;
  const params: unknown[] = [refId, centerId, range.start || toISODate(new Date())];
  if (range.end) {
    sql += " AND (NULLIF(start_date, '') IS NULL OR start_date <= ?)";
    params.push(range.end);
  }
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows = (await q.prepare(sql).all(...params)) as { id: number; name: string; schedule: string }[];
  for (const row of rows) {
    let other: ScheduleEntry[];
    try {
      other = JSON.parse(row.schedule || '[]');
    } catch {
      other = [];
    }
    for (const a of schedule) {
      for (const b of other) {
        if (a.day === Number(b.day) && a.start < b.end && b.start < a.end) {
          return { className: row.name, day: a.day, start: a.start, end: a.end };
        }
      }
    }
  }
  return null;
}

/**
 * Khóa advisory theo phòng/giáo viên (tới hết transaction) rồi kiểm tra trùng lịch:
 * 2 request tạo/sửa lớp đồng thời không thể cùng lọt qua bước kiểm tra.
 * Thứ tự khóa cố định (phòng trước, giáo viên sau) để tránh deadlock.
 */
async function lockAndAssertNoConflicts(
  tx: Q,
  p: {
    roomId: number | null;
    teacherId: number | null;
    schedule: ScheduleEntry[];
    excludeId: number | null;
    centerId: number;
    range: { start: string | null; end: string | null };
  }
): Promise<void> {
  if (p.roomId) await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`class-room:${p.roomId}`);
  if (p.teacherId) {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`class-teacher:${p.teacherId}`);
  }
  if (p.roomId) {
    const c = await findConflict(tx, 'room_id', p.roomId, p.schedule, p.excludeId, p.centerId, p.range);
    if (c) {
      const room = (await tx.prepare('SELECT name FROM rooms WHERE id = ?').get(p.roomId)) as
        { name: string } | undefined;
      throw AppError.badRequest(
        `Phòng "${room?.name || ''}" bị trùng lịch với lớp "${c.className}" (${DAY_NAMES[c.day]} ${c.start}-${c.end})`
      );
    }
  }
  if (p.teacherId) {
    const c = await findConflict(tx, 'teacher_id', p.teacherId, p.schedule, p.excludeId, p.centerId, p.range);
    if (c) {
      const t = (await tx.prepare('SELECT name FROM teachers WHERE id = ?').get(p.teacherId)) as
        { name: string } | undefined;
      throw AppError.badRequest(
        `Giáo viên "${t?.name || ''}" bị trùng lịch với lớp "${c.className}" (${DAY_NAMES[c.day]} ${c.start}-${c.end})`
      );
    }
  }
}

/** Kiểm tra giáo viên tồn tại và thuộc trung tâm (chống gán giáo viên center khác). */
async function resolveTeacherId(teacherId: number | null, centerId: number): Promise<number | null> {
  if (!teacherId) return null;
  const t = (await db.prepare('SELECT id, center_id FROM teachers WHERE id = ?').get(teacherId)) as
    { id: number; center_id: number | null } | undefined;
  if (!t) throw AppError.badRequest('Không tìm thấy giáo viên');
  if (t.center_id !== centerId) throw AppError.badRequest('Giáo viên không thuộc trung tâm này');
  return t.id;
}

/** Lấy lớp trong scope — ném 404 nếu không thấy (tránh lộ dữ liệu center khác). */
async function getScopedClass(ctx: ScopeCtx, id: number): Promise<ClassRow> {
  const scope = classScopeWhere(ctx);
  const cls = (await db
    .prepare(`SELECT c.* FROM classes c WHERE c.id = ?${scope.clause}`)
    .get(id, ...scope.params)) as ClassRow | undefined;
  if (!cls) throw AppError.notFound('Không tìm thấy lớp học');
  return cls;
}

/** Chuẩn hóa input tạo/sửa lớp — ném 400 nếu thiếu/sai. */
function normalizeInput(input: ClassInput): {
  name: string;
  teacherId: number | null;
  schedule: ScheduleEntry[];
  startDate: string | null;
  endDate: string | null;
  fee: number;
  maxStudents: number;
  status: string;
} {
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Tên lớp học là bắt buộc');
  const fee = Number(input.tuition_fee);
  if (!Number.isFinite(fee) || fee < 0) throw AppError.badRequest('Học phí không hợp lệ');
  const startDate = input.start_date || null;
  const endDate = input.end_date || null;
  if (startDate && endDate && endDate < startDate) {
    throw AppError.badRequest('Ngày kết thúc phải sau ngày bắt đầu');
  }
  return {
    name,
    teacherId: input.teacher_id ? Number(input.teacher_id) : null,
    schedule: parseSchedule(input.schedule ?? []),
    startDate,
    endDate,
    fee,
    maxStudents: Number(input.max_students) > 0 ? Number(input.max_students) : 30,
    status: input.status === 'inactive' ? 'inactive' : 'active',
  };
}

/* --------------------------------- CRUD lớp --------------------------------- */

export async function listClasses(
  ctx: ScopeCtx,
  query: { search?: string; teacherId?: number } = {},
  pageOpts: PageOptions = {}
): Promise<Paginated<unknown>> {
  const scope = classScopeWhere(ctx);
  // Tìm theo tên lớp: escape wildcard để %, _ trong input không match toàn bộ DB
  const { search = '' } = query;
  const searchClause = search ? " AND c.name LIKE ? ESCAPE '\\'" : '';
  const teacherClause = query.teacherId !== undefined ? ' AND c.teacher_id = ?' : '';
  const params = [
    ...scope.params,
    ...(search ? [`%${escapeLike(search)}%`] : []),
    ...(query.teacherId !== undefined ? [query.teacherId] : []),
  ];
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db
      .prepare(`SELECT COUNT(*) as c FROM classes c WHERE 1=1${scope.clause}${searchClause}${teacherClause}`)
      .get(...params)) as {
      c: number;
    }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT c.*, t.name as teacher_name, r.name as room_name,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') as student_count
       FROM classes c LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE 1=1${scope.clause}${searchClause}${teacherClause}
       ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as unknown[];
  return paginate(rows, total, page, limit);
}

export async function getClassDetail(ctx: ScopeCtx, id: number): Promise<Record<string, unknown>> {
  const scope = classScopeWhere(ctx);
  const cls = await db
    .prepare(
      `SELECT c.*, t.name as teacher_name, r.name as room_name FROM classes c
       LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE c.id = ?${scope.clause}`
    )
    .get(id, ...scope.params);
  if (!cls) throw AppError.notFound('Không tìm thấy lớp học');
  const students = await db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone, s.status as student_status, e.id as enrollment_id, e.enrolled_at
       FROM enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.class_id = ? AND e.status = 'active' ORDER BY s.name`
    )
    .all(id);
  const sessionCount = (
    (await db
      .prepare("SELECT COUNT(*) as c FROM sessions WHERE class_id = ? AND status <> 'cancelled'")
      .get(id)) as { c: number }
  ).c;
  return { class: cls, students, sessionCount };
}

export async function createClass(ctx: ScopeCtx, input: ClassInput): Promise<unknown> {
  const n = normalizeInput(input);
  // Route truyền ctx.centerId = requireCenterId(req): superadmin phải chọn trung tâm, không rơi về tenant #1
  const centerId = ctx.centerId;
  if (centerId === null)
    throw new AppError(
      400,
      'Superadmin cần chọn trung tâm (ô "Trung tâm" trên thanh tiêu đề) trước khi thao tác',
      'CENTER_REQUIRED'
    );
  const roomId = await resolveRoomId(input.room_id, centerId);
  const teacherId = await resolveTeacherId(n.teacherId, centerId);
  const id = await db.transaction(async (tx) => {
    await lockAndAssertNoConflicts(tx, {
      roomId,
      teacherId,
      schedule: n.schedule,
      excludeId: null,
      centerId,
      range: { start: n.startDate, end: n.endDate },
    });
    const r = await tx
      .prepare(
        'INSERT INTO classes (name, teacher_id, schedule, start_date, end_date, tuition_fee, max_students, status, center_id, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        n.name,
        teacherId,
        JSON.stringify(n.schedule),
        n.startDate,
        n.endDate,
        n.fee,
        n.maxStudents,
        n.status,
        centerId,
        roomId
      );
    const newId = Number(r.lastInsertRowid);
    // Sinh buổi học ngay khi tạo lớp (không còn sinh lười lúc GET)
    if (n.status === 'active') await generateSessionsForClass(newId, { q: tx });
    return newId;
  });
  return await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
}

/**
 * Đồng bộ buổi học sau khi sửa lớp (cùng transaction):
 * - Đổi giáo viên: chỉ buổi từ hôm nay (giờ VN) chưa check-in chuyển sang GV mới — lương quá khứ giữ nguyên.
 * - Đổi lịch/khoảng ngày: xóa buổi từ hôm nay thuộc thứ bị bỏ hoặc nằm ngoài [start_date, end_date],
 *   chỉ khi chưa có điểm danh/check-in.
 * - Sinh bổ sung buổi theo lịch mới từ hôm nay (buổi đã hủy không bị hồi sinh).
 */
async function syncSessionsAfterUpdate(
  tx: Q,
  id: number,
  old: ClassRow,
  n: ReturnType<typeof normalizeInput>,
  teacherId: number | null
): Promise<void> {
  const today = toISODate(new Date());
  if ((old.teacher_id ?? null) !== teacherId) {
    await tx
      .prepare(
        `UPDATE sessions SET teacher_id = ? WHERE class_id = ? AND date >= ?
           AND NOT EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = sessions.id)`
      )
      .run(teacherId, id, today);
  }
  const newDays = new Set(n.schedule.map((e) => e.day));
  const removed = scheduleDays(old.schedule as string).filter((d) => !newDays.has(d));
  const conds: string[] = [];
  const params: unknown[] = [];
  if (removed.length)
    conds.push(`EXTRACT(ISODOW FROM sessions.date::date)::int + 1 IN (${removed.join(',')})`);
  if (n.startDate) {
    conds.push('sessions.date < ?');
    params.push(n.startDate);
  }
  if (n.endDate) {
    conds.push('sessions.date > ?');
    params.push(n.endDate);
  }
  if (conds.length) {
    await tx
      .prepare(
        `DELETE FROM sessions WHERE class_id = ? AND date >= ? AND (${conds.join(' OR ')})
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = sessions.id)
           AND NOT EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = sessions.id)`
      )
      .run(id, today, ...params);
  }
  if (n.status === 'active') await generateSessionsForClass(id, { from: today, q: tx });
}

export async function updateClass(ctx: ScopeCtx, id: number, input: ClassInput): Promise<unknown> {
  const existing = await getScopedClass(ctx, id);
  const n = normalizeInput(input);
  const centerId = existing.center_id ?? ctx.centerId;
  if (centerId === null) throw AppError.badRequest('Lớp học chưa gắn trung tâm');
  const roomId = await resolveRoomId(input.room_id, centerId);
  const teacherId = await resolveTeacherId(n.teacherId, centerId);
  await db.transaction(async (tx) => {
    await lockAndAssertNoConflicts(tx, {
      roomId,
      teacherId,
      schedule: n.schedule,
      excludeId: id,
      centerId,
      range: { start: n.startDate, end: n.endDate },
    });
    // Chặn giảm sĩ số tối đa dưới số học viên đang học
    const activeCount = (
      (await tx
        .prepare("SELECT COUNT(*) as c FROM enrollments WHERE class_id = ? AND status = 'active'")
        .get(id)) as { c: number }
    ).c;
    if (n.maxStudents < Number(activeCount)) {
      throw AppError.badRequest(
        `Không thể giảm sĩ số tối đa xuống ${n.maxStudents} vì lớp đang có ${activeCount} học viên`
      );
    }
    await tx
      .prepare(
        'UPDATE classes SET name=?, teacher_id=?, schedule=?, start_date=?, end_date=?, tuition_fee=?, max_students=?, status=?, room_id=? WHERE id=?'
      )
      .run(
        n.name,
        teacherId,
        JSON.stringify(n.schedule),
        n.startDate,
        n.endDate,
        n.fee,
        n.maxStudents,
        n.status,
        roomId,
        id
      );
    await syncSessionsAfterUpdate(tx, id, existing, n, teacherId);
  });
  return await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
}

export async function deleteClass(ctx: ScopeCtx, id: number, actor?: AuditActor): Promise<void> {
  const cls = await getScopedClass(ctx, id);
  // Chặn xóa lớp còn bài tập (tránh mất lịch sử chấm điểm thầm lặng)
  const hwCount = await homeworkRepo.countByClass(id);
  if (hwCount > 0) {
    throw AppError.badRequest(`Lớp còn ${hwCount} bài tập. Hãy xóa bài tập trước khi xóa lớp.`);
  }
  // Chặn xóa lớp đã có điểm danh/check-in: xóa sẽ làm mất lịch sử lương giáo viên + chuyên cần
  const history = (await db
    .prepare(
      `SELECT 1 FROM sessions s WHERE s.class_id = ?
         AND (EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
              OR EXISTS (SELECT 1 FROM teacher_checkins tc WHERE tc.session_id = s.id))
       LIMIT 1`
    )
    .get(id)) as { '1'?: number } | undefined;
  if (history) {
    throw AppError.badRequest(
      'Lớp đã có điểm danh/check-in, không thể xóa (sẽ mất lịch sử lương và chuyên cần). Hãy chuyển lớp sang "Ngừng hoạt động".'
    );
  }
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM sessions WHERE class_id = ?').run(id);
    await tx.prepare('DELETE FROM enrollments WHERE class_id = ?').run(id);
    await tx.prepare('DELETE FROM classes WHERE id = ?').run(id);
  });
  await audit({
    centerId: ctx.centerId,
    actor,
    action: 'delete',
    entity: 'classes',
    entityId: id,
    summary: `Xóa lớp học ${cls.name} (kèm buổi học + ghi danh)`,
  });
}

/* --------------------------------- Ghi danh --------------------------------- */

export async function enrollStudent(ctx: ScopeCtx, classId: number, studentId: number): Promise<void> {
  if (!studentId) throw AppError.badRequest('Thiếu student_id');
  const cls = await getScopedClass(ctx, classId); // kiểm tra scope center (404 nếu khác center)
  const student = (await db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(Number(studentId))) as { id: number; center_id: number | null } | undefined;
  // Học viên phải cùng trung tâm với lớp (kể cả khi superadmin thao tác)
  if (!student || student.center_id !== cls.center_id) {
    throw AppError.notFound('Không tìm thấy học viên');
  }
  // Bọc trong transaction + lock row lớp: chống 2 request đồng thời cùng vượt sĩ số
  await db.transaction((tx) => enrollInTx(tx, classId, studentId));
}

/**
 * Ghi danh trong transaction có sẵn: lock row lớp (FOR UPDATE), chặn lớp ngừng hoạt động/đủ sĩ số.
 * Dùng chung cho ghi danh thủ công và chuyển đổi học thử/lead thành học viên.
 */
export async function enrollInTx(tx: Q, classId: number, studentId: number): Promise<void> {
  const locked = (await tx
    .prepare('SELECT max_students, status FROM classes WHERE id = ? FOR UPDATE')
    .get(classId)) as { max_students: number; status?: string } | undefined;
  if (!locked) throw AppError.notFound('Không tìm thấy lớp học');
  if (locked.status === 'inactive') throw AppError.badRequest('Lớp học đã ngừng hoạt động');
  const count = (
    (await tx
      .prepare("SELECT COUNT(*) as c FROM enrollments WHERE class_id = ? AND status = 'active'")
      .get(classId)) as { c: number }
  ).c;
  if (Number(count) >= locked.max_students) throw AppError.badRequest('Lớp học đã đủ sĩ số tối đa');
  const exists = await tx
    .prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND class_id = ? AND status = ?')
    .get(studentId, classId, 'active');
  if (exists) throw AppError.badRequest('Học viên đã có trong lớp này');
  // Nếu từng ghi danh rồi nghỉ thì kích hoạt lại, ngược lại thêm mới
  const old = await tx
    .prepare('SELECT id FROM enrollments WHERE student_id = ? AND class_id = ?')
    .get(studentId, classId);
  if (old) {
    await tx
      .prepare("UPDATE enrollments SET status = 'active' WHERE student_id = ? AND class_id = ?")
      .run(studentId, classId);
  } else {
    await tx.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classId);
  }
}

export async function unenroll(ctx: ScopeCtx, enrollmentId: number): Promise<void> {
  const scope = classScopeWhere(ctx);
  const cls = await db
    .prepare(
      `SELECT c.id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = ?${scope.clause}`
    )
    .get(enrollmentId, ...scope.params);
  if (!cls) throw AppError.notFound('Không tìm thấy ghi danh');
  await db.prepare("UPDATE enrollments SET status = 'inactive' WHERE id = ?").run(enrollmentId);
}
