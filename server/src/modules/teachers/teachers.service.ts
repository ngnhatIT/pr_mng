import { db } from '../../db';
import { AppError } from '../../shared/errors';
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
export async function listTeachers(
  centerId: number | null,
  pageOpts: PageOptions = {}
): Promise<Paginated<TeacherRow>> {
  const where = centerId !== null ? 'WHERE t.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [centerId] : [];
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM teachers t ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM classes WHERE teacher_id = t.id AND status = 'active') as class_count
       FROM teachers t ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as TeacherRow[];
  return paginate(rows, total, page, limit);
}

/** Chi tiết giáo viên kèm số lớp đang dạy; 404 khi không tồn tại hoặc khác center. */
export async function getTeacherDetail(centerId: number | null, id: number): Promise<TeacherRow> {
  const where = centerId !== null ? 'AND t.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [id, centerId] : [id];
  const row = (await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM classes WHERE teacher_id = t.id AND status = 'active') as class_count
       FROM teachers t WHERE t.id = ? ${where}`
    )
    .get(...params)) as TeacherRow | undefined;
  if (!row) throw AppError.notFound('Không tìm thấy giáo viên');
  return row;
}
