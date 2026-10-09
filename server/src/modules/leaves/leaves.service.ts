import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export const LEAVE_STATUS = ['pending', 'approved', 'rejected'] as const;

export interface LeaveRow {
  id: number;
  student_id: number;
  student_name?: string;
  student_code?: string;
  class_name?: string | null;
  [key: string]: unknown;
}

export interface LeaveQuery {
  status?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách đơn xin nghỉ (có phân trang). Scope center qua học viên. */
export async function listLeaves(
  centerId: number | null,
  query: LeaveQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<LeaveRow>> {
  const { status = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  if (status && (LEAVE_STATUS as readonly string[]).includes(status)) {
    conds.push('lr.status = ?');
    params.push(status);
  }
  const from = `FROM leave_requests lr
       JOIN students s ON s.id = lr.student_id
       LEFT JOIN classes c ON c.id = lr.class_id`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  const rows = (await db
    .prepare(
      `SELECT lr.*, s.name as student_name, s.code as student_code, c.name as class_name
       ${from} ${where} ORDER BY lr.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as LeaveRow[];
  return paginate(rows, total, page, limit);
}
