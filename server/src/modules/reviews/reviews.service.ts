import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export interface ReviewRow {
  id: number;
  rating?: number;
  comment?: string | null;
  status?: string;
  created_at?: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  [key: string]: unknown;
}

export interface ReviewQuery {
  status?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách đánh giá (có phân trang). */
export function listReviews(
  centerId: number | null,
  query: ReviewQuery,
  pageOpts: PageOptions = {}
): Paginated<ReviewRow> {
  const { status = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('r.center_id = ?');
    params.push(centerId);
  }
  if (status) {
    conds.push('r.status = ?');
    params.push(status);
  }
  const from = `FROM reviews r LEFT JOIN parents p ON p.id = r.parent_id`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
         p.name as parent_name, p.phone as parent_phone
       ${from} ${where}
       ORDER BY r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ReviewRow[];
  return paginate(rows, total, page, limit);
}
