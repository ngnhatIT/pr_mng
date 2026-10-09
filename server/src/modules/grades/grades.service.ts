import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/** Parse ID từ query, throw 400 nếu không hợp lệ. */
function parseQueryId(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('ID không hợp lệ');
  return n;
}

/* ---------------------------------- Types ---------------------------------- */

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface ScopeCtx {
  centerId: number | null; // null = superadmin (thấy mọi trung tâm)
  role: string;
  teacherId: number | null;
}

export interface GradeRow {
  id: number;
  student_id: number;
  student_name?: string;
  student_code?: string;
  class_name?: string | null;
  [key: string]: unknown;
}

export interface GradeQuery {
  student_id?: string;
  class_id?: string;
}

/* --------------------------------- Service --------------------------------- */

/**
 * Danh sách điểm (có phân trang).
 * - Scope center qua học viên (join students).
 * - Giáo viên chỉ thấy điểm của lớp mình dạy.
 */
export async function listGrades(
  ctx: ScopeCtx,
  query: GradeQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<GradeRow>> {
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (ctx.centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(ctx.centerId);
  }
  if (ctx.role === 'teacher' && ctx.teacherId) {
    conds.push('c.teacher_id = ?');
    params.push(ctx.teacherId);
  }
  const { student_id = '', class_id = '' } = query;
  if (student_id) {
    conds.push('g.student_id = ?');
    params.push(parseQueryId(student_id));
  }
  if (class_id) {
    conds.push('g.class_id = ?');
    params.push(parseQueryId(class_id));
  }
  const from = `FROM grades g
       JOIN students s ON s.id = g.student_id
       LEFT JOIN classes c ON c.id = g.class_id`;
  const where = `WHERE ${conds.join(' AND ')}`;
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  const rows = (await db
    .prepare(
      `SELECT g.*, s.name as student_name, s.code as student_code, c.name as class_name
       ${from} ${where} ORDER BY g.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as GradeRow[];
  return paginate(rows, total, page, limit);
}

/* ------------------------------ Nhập / xóa điểm ------------------------------ */

export interface GradeCreateInput {
  centerId: number | null;
  student_id: number;
  class_id: number | null;
  title: string;
  score: number;
  max_score: number;
  comment?: string | null;
  created_by: number;
  role: string;
  teacher_id: number | null;
}

/**
 * Nhập điểm — validate ở application layer (400 thay vì 500 từ DB CHECK),
 * kiểm tra enrollment, ghi audit.
 */
export async function createGrade(input: GradeCreateInput): Promise<GradeRow> {
  const student = (await db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(input.student_id)) as { id: number; center_id: number | null } | undefined;
  if (!student || (input.centerId !== null && student.center_id !== input.centerId)) {
    throw AppError.notFound('Không tìm thấy học viên');
  }
  let classId: number | null = null;
  if (input.class_id) {
    const cls = (await db
      .prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?')
      .get(input.class_id)) as
      { id: number; center_id: number | null; teacher_id: number | null } | undefined;
    if (!cls || (input.centerId !== null && cls.center_id !== input.centerId)) {
      throw AppError.notFound('Không tìm thấy lớp học');
    }
    if (input.role === 'teacher') {
      if (!input.teacher_id || cls.teacher_id !== input.teacher_id) {
        throw AppError.forbidden('Bạn chỉ được nhập điểm cho lớp của mình');
      }
    }
    classId = cls.id;
    // Học viên phải đang học lớp này (chống điểm "mồ côi" gắn nhầm lớp)
    const enrolled = await db
      .prepare("SELECT 1 FROM enrollments WHERE student_id = ? AND class_id = ? AND status = 'active'")
      .get(input.student_id, classId);
    if (!enrolled) {
      throw AppError.badRequest('Học viên không thuộc lớp học này');
    }
  } else if (input.role === 'teacher') {
    throw AppError.badRequest('Vui lòng chọn lớp học');
  }

  const sc = Number(input.score);
  const mx = Number(input.max_score);
  if (!Number.isFinite(sc)) throw AppError.badRequest('Điểm số không hợp lệ');
  if (!Number.isFinite(mx) || mx <= 0) throw AppError.badRequest('Điểm tối đa phải lớn hơn 0');
  // Validate biên ở application layer → 400 thay vì 500 từ DB CHECK
  if (sc < 0 || sc > mx) {
    throw AppError.badRequest(`Điểm phải nằm trong khoảng 0–${mx}`);
  }

  const r = await db
    .prepare(
      'INSERT INTO grades (center_id, student_id, class_id, title, score, max_score, comment, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      input.centerId,
      student.id,
      classId,
      input.title.trim(),
      sc,
      mx,
      input.comment || null,
      input.created_by
    );
  const row = (await db
    .prepare('SELECT * FROM grades WHERE id = ?')
    .get(Number(r.lastInsertRowid))) as GradeRow;
  void audit({
    centerId: input.centerId,
    actor: { id: input.created_by, role: input.role } as AuditActor,
    action: 'create',
    entity: 'grades',
    entityId: Number(r.lastInsertRowid),
    summary: `Nhập điểm ${sc}/${mx} — ${input.title} (HV#${student.id})`,
    meta: { student_id: student.id, class_id: classId, score: sc, max_score: mx },
  });
  return row;
}

/** Xóa điểm — kiểm tra scope + ghi audit. */
export async function deleteGrade(
  centerId: number | null,
  id: number,
  role: string,
  teacherId: number | null,
  actor?: AuditActor
): Promise<void> {
  const grade = (await db
    .prepare(
      `SELECT g.id, g.title, g.score, g.max_score, s.center_id, c.teacher_id
       FROM grades g
       JOIN students s ON s.id = g.student_id
       LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.id = ?`
    )
    .get(id)) as
    | {
        id: number;
        title: string;
        score: number;
        max_score: number;
        center_id: number | null;
        teacher_id: number | null;
      }
    | undefined;
  if (!grade || (centerId !== null && grade.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy điểm');
  }
  if (role === 'teacher' && (!teacherId || grade.teacher_id !== teacherId)) {
    throw AppError.forbidden('Bạn chỉ được xóa điểm của lớp mình');
  }
  await db.prepare('DELETE FROM grades WHERE id = ?').run(id);
  void audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'grades',
    entityId: id,
    summary: `Xóa điểm ${grade.score}/${grade.max_score} — ${grade.title}`,
    meta: { title: grade.title, score: grade.score },
  });
}
