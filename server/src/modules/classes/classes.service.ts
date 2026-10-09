import { db, ScheduleEntry, DAY_NAMES } from '../../db';
import { getDefaultCenter } from '../../utils/plans';
import { AppError } from '../../shared/errors';
import { homeworkRepo } from '../homework/homework.repo';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, type AuditActor } from '../../shared/audit';

/* ---------------------------------- Types ---------------------------------- */

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface ScopeCtx {
  centerId: number | null; // null = superadmin (thấy mọi trung tâm)
  role: string;
  teacherId: number | null;
}

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

/**
 * Điều kiện scope cho bảng classes (alias c):
 * - center: superadmin bypass, còn lại lọc c.center_id
 * - role teacher: chỉ lớp do mình dạy
 */
export function classScopeWhere(ctx: ScopeCtx): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (ctx.centerId !== null) {
    conds.push('c.center_id = ?');
    params.push(ctx.centerId);
  }
  if (ctx.role === 'teacher' && ctx.teacherId) {
    conds.push('c.teacher_id = ?');
    params.push(ctx.teacherId);
  } else if (ctx.role === 'teacher') {
    conds.push('1 = 0'); // giáo viên chưa gắn teacher_id thì không thấy lớp nào
  }
  return { clause: conds.length ? ' AND ' + conds.join(' AND ') : '', params };
}

/** Parse & validate lịch học — ném 400 nếu sai định dạng. */
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
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw AppError.badRequest('Giờ học phải có dạng HH:MM');
    }
    value.push({ day, start, end });
  }
  return value;
}

/** center_id khi tạo lớp: superadmin dùng trung tâm mặc định. */
async function resolveCenterId(ctx: ScopeCtx): Promise<number | null> {
  if (ctx.centerId !== null) return ctx.centerId;
  return (await getDefaultCenter())?.id ?? null;
}

/** Kiểm tra room_id hợp lệ trong scope — trả về id đã chuẩn hóa (hoặc null). */
async function resolveRoomId(
  ctx: ScopeCtx,
  roomId: unknown,
  centerId: number | null
): Promise<number | null> {
  if (roomId === undefined || roomId === null || roomId === '') return null;
  const id = Number(roomId);
  if (!Number.isFinite(id) || id <= 0) throw AppError.badRequest('Phòng học không hợp lệ');
  const room = (await db.prepare('SELECT id, center_id FROM rooms WHERE id = ?').get(id)) as
    { id: number; center_id: number | null } | undefined;
  if (!room) throw AppError.notFound('Không tìm thấy phòng học');
  if (ctx.role !== 'superadmin' && centerId !== null && room.center_id !== centerId) {
    throw AppError.badRequest('Phòng học không thuộc trung tâm này');
  }
  return room.id;
}

interface RoomConflict {
  className: string;
  day: number;
  start: string;
  end: string;
  roomName: string;
}

/** Kiểm tra trùng lịch phòng: cùng room, cùng day, khung giờ giao nhau. */
async function findRoomConflict(
  roomId: number,
  schedule: ScheduleEntry[],
  excludeId: number | null,
  centerId: number | null
): Promise<RoomConflict | null> {
  if (!roomId || schedule.length === 0) return null;
  const room = (await db.prepare('SELECT name FROM rooms WHERE id = ?').get(roomId)) as
    { name: string } | undefined;
  const roomName = room?.name || '';
  let sql = 'SELECT id, name, schedule FROM classes WHERE room_id = ? AND status = ?';
  const params: unknown[] = [roomId, 'active'];
  if (centerId !== null) {
    sql += ' AND center_id = ?';
    params.push(centerId);
  }
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows = (await db.prepare(sql).all(...params)) as { id: number; name: string; schedule: string }[];
  for (const row of rows) {
    let other: ScheduleEntry[];
    try {
      other = JSON.parse(row.schedule || '[]');
    } catch {
      other = [];
    }
    for (const a of schedule) {
      for (const b of other) {
        if (a.day === b.day && a.start < b.end && b.start < a.end) {
          return { className: row.name, day: a.day, start: a.start, end: a.end, roomName };
        }
      }
    }
  }
  return null;
}

async function assertNoRoomConflict(
  roomId: number | null,
  schedule: ScheduleEntry[],
  excludeId: number | null,
  centerId: number | null
): Promise<void> {
  const conflict = await findRoomConflict(roomId || 0, schedule, excludeId, centerId);
  if (conflict) {
    throw AppError.badRequest(
      `Phòng "${conflict.roomName}" bị trùng lịch với lớp "${conflict.className}" (${DAY_NAMES[conflict.day]} ${conflict.start}-${conflict.end})`
    );
  }
}

/** Kiểm tra trùng lịch giáo viên: cùng teacher, cùng day, khung giờ giao nhau. */
async function findTeacherConflict(
  teacherId: number,
  schedule: ScheduleEntry[],
  excludeId: number | null,
  centerId: number | null
): Promise<{ className: string; day: number; start: string; end: string; teacherName: string } | null> {
  if (!teacherId || schedule.length === 0) return null;
  const teacher = (await db.prepare('SELECT name FROM teachers WHERE id = ?').get(teacherId)) as
    { name: string } | undefined;
  const teacherName = teacher?.name || '';
  let sql = 'SELECT id, name, schedule FROM classes WHERE teacher_id = ? AND status = ?';
  const params: unknown[] = [teacherId, 'active'];
  if (centerId !== null) {
    sql += ' AND center_id = ?';
    params.push(centerId);
  }
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows = (await db.prepare(sql).all(...params)) as { id: number; name: string; schedule: string }[];
  for (const row of rows) {
    let other: ScheduleEntry[];
    try {
      other = JSON.parse(row.schedule || '[]');
    } catch {
      other = [];
    }
    for (const a of schedule) {
      for (const b of other) {
        if (a.day === b.day && a.start < b.end && b.start < a.end) {
          return { className: row.name, day: a.day, start: a.start, end: a.end, teacherName };
        }
      }
    }
  }
  return null;
}

async function assertNoTeacherConflict(
  teacherId: number | null,
  schedule: ScheduleEntry[],
  excludeId: number | null,
  centerId: number | null
): Promise<void> {
  if (!teacherId) return;
  const conflict = await findTeacherConflict(teacherId, schedule, excludeId, centerId);
  if (conflict) {
    throw AppError.badRequest(
      `Giáo viên "${conflict.teacherName}" bị trùng lịch với lớp "${conflict.className}" (${DAY_NAMES[conflict.day]} ${conflict.start}-${conflict.end})`
    );
  }
}

/** Kiểm tra giáo viên tồn tại và thuộc trung tâm (chống gán giáo viên center khác). */
async function resolveTeacherId(teacherId: number | null, centerId: number | null): Promise<number | null> {
  if (!teacherId) return null;
  const t = (await db.prepare('SELECT id, center_id FROM teachers WHERE id = ?').get(teacherId)) as
    { id: number; center_id: number | null } | undefined;
  if (!t) throw AppError.badRequest('Không tìm thấy giáo viên');
  if (centerId !== null && t.center_id !== centerId) {
    throw AppError.badRequest('Giáo viên không thuộc trung tâm này');
  }
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

export async function listClasses(ctx: ScopeCtx, pageOpts: PageOptions = {}): Promise<Paginated<unknown>> {
  const scope = classScopeWhere(ctx);
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db
      .prepare(`SELECT COUNT(*) as c FROM classes c WHERE 1=1${scope.clause}`)
      .get(...scope.params)) as {
      c: number;
    }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT c.*, t.name as teacher_name, r.name as room_name,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') as student_count
       FROM classes c LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE 1=1${scope.clause}
       ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .all(...scope.params, limit, offset)) as unknown[];
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
    (await db.prepare('SELECT COUNT(*) as c FROM sessions WHERE class_id = ?').get(id)) as { c: number }
  ).c;
  return { class: cls, students, sessionCount };
}

export async function createClass(ctx: ScopeCtx, input: ClassInput): Promise<unknown> {
  const n = normalizeInput(input);
  const centerId = await resolveCenterId(ctx);
  const roomId = await resolveRoomId(ctx, input.room_id, centerId);
  await assertNoRoomConflict(roomId, n.schedule, null, centerId);
  const teacherId = await resolveTeacherId(n.teacherId, centerId);
  await assertNoTeacherConflict(teacherId, n.schedule, null, centerId);
  const r = await db
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
  return await db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(r.lastInsertRowid));
}

export async function updateClass(ctx: ScopeCtx, id: number, input: ClassInput): Promise<unknown> {
  const existing = await getScopedClass(ctx, id);
  const n = normalizeInput(input);
  const centerId = (existing.center_id as number | null) ?? (await resolveCenterId(ctx));
  const roomId = await resolveRoomId(ctx, input.room_id, centerId);
  await assertNoRoomConflict(roomId, n.schedule, id, centerId);
  const teacherId = await resolveTeacherId(n.teacherId, centerId);
  await assertNoTeacherConflict(teacherId, n.schedule, id, centerId);
  // Chặn giảm sĩ số tối đa dưới số học viên đang học
  const activeCount = (
    (await db
      .prepare("SELECT COUNT(*) as c FROM enrollments WHERE class_id = ? AND status = 'active'")
      .get(id)) as {
      c: number;
    }
  ).c;
  if (n.maxStudents < activeCount) {
    throw AppError.badRequest(
      `Không thể giảm sĩ số tối đa xuống ${n.maxStudents} vì lớp đang có ${activeCount} học viên`
    );
  }
  await db
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
  return await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
}

export async function deleteClass(ctx: ScopeCtx, id: number, actor?: AuditActor): Promise<void> {
  const cls = await getScopedClass(ctx, id);
  // Chặn xóa lớp còn bài tập (tránh mất lịch sử chấm điểm thầm lặng)
  const hwCount = await homeworkRepo.countByClass(id);
  if (hwCount > 0) {
    throw AppError.badRequest(`Lớp còn ${hwCount} bài tập. Hãy xóa bài tập trước khi xóa lớp.`);
  }
  await db.transaction(async (tx) => {
    const sessIds = (await tx.prepare('SELECT id FROM sessions WHERE class_id = ?').all(id)) as {
      id: number;
    }[];
    for (const s of sessIds) await tx.prepare('DELETE FROM attendance WHERE session_id = ?').run(s.id);
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
  await getScopedClass(ctx, classId); // kiểm tra scope center (404 nếu khác center)
  const student = (await db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(Number(studentId))) as { id: number; center_id: number | null } | undefined;
  if (!student || (ctx.centerId !== null && student.center_id !== ctx.centerId)) {
    throw AppError.notFound('Không tìm thấy học viên');
  }
  // Bọc trong transaction + lock row lớp: chống 2 request đồng thời cùng vượt sĩ số
  await db.transaction(async (tx) => {
    const locked = (await tx
      .prepare('SELECT max_students FROM classes WHERE id = ? FOR UPDATE')
      .get(classId)) as { max_students: number } | undefined;
    if (!locked) throw AppError.notFound('Không tìm thấy lớp học');
    const count = (
      (await tx
        .prepare("SELECT COUNT(*) as c FROM enrollments WHERE class_id = ? AND status = 'active'")
        .get(classId)) as { c: number }
    ).c;
    if (count >= locked.max_students) throw AppError.badRequest('Lớp học đã đủ sĩ số tối đa');
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
      await tx
        .prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)')
        .run(studentId, classId);
    }
  });
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
