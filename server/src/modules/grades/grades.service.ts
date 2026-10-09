import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

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
export function listGrades(
  ctx: ScopeCtx,
  query: GradeQuery,
  pageOpts: PageOptions = {}
): Paginated<GradeRow> {
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
    params.push(Number(student_id));
  }
  if (class_id) {
    conds.push('g.class_id = ?');
    params.push(Number(class_id));
  }
  const from = `FROM grades g
       JOIN students s ON s.id = g.student_id
       LEFT JOIN classes c ON c.id = g.class_id`;
  const where = `WHERE ${conds.join(' AND ')}`;
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT g.*, s.name as student_name, s.code as student_code, c.name as class_name
       ${from} ${where} ORDER BY g.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as GradeRow[];
  return paginate(rows, total, page, limit);
}
