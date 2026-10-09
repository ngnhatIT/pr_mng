import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export const TRIAL_STATUS = ['new', 'contacted', 'converted'] as const;

export interface TrialRow {
  id: number;
  center_id: number | null;
  class_name?: string | null;
  [key: string]: unknown;
}

export interface TrialQuery {
  status?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách đăng ký học thử (có phân trang). */
export function listTrials(
  centerId: number | null,
  query: TrialQuery,
  pageOpts: PageOptions = {}
): Paginated<TrialRow> {
  const { status = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('tr.center_id = ?');
    params.push(centerId);
  }
  if (status && (TRIAL_STATUS as readonly string[]).includes(status)) {
    conds.push('tr.status = ?');
    params.push(status);
  }
  const from = `FROM trial_registrations tr LEFT JOIN classes c ON c.id = tr.class_id`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT tr.*, c.name as class_name ${from} ${where} ORDER BY tr.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as TrialRow[];
  return paginate(rows, total, page, limit);
}
