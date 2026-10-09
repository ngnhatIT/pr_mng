import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export interface TeacherRow {
  id: number;
  name: string;
  center_id: number | null;
  class_count?: number;
  [key: string]: unknown;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách giáo viên kèm số lớp đang dạy (có phân trang). */
export function listTeachers(centerId: number | null, pageOpts: PageOptions = {}): Paginated<TeacherRow> {
  const where = centerId !== null ? 'WHERE t.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [centerId] : [];
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (db.prepare(`SELECT COUNT(*) as c FROM teachers t ${where}`).get(...params) as { c: number })
    .c;
  const rows = db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM classes WHERE teacher_id = t.id AND status = 'active') as class_count
       FROM teachers t ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as TeacherRow[];
  return paginate(rows, total, page, limit);
}
