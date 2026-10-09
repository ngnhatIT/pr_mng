import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export const LEAD_STATUS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;

export interface LeadRow {
  id: number;
  center_id: number | null;
  name: string;
  phone: string;
  [key: string]: unknown;
}

export interface LeadQuery {
  status?: string;
  search?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách lead (có phân trang). */
export async function listLeads(
  centerId: number | null,
  query: LeadQuery,
  pageOpts: PageOptions = {}
):  Promise<Paginated<LeadRow>> {
  const { status = '', search = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  if (status && (LEAD_STATUS as readonly string[]).includes(status)) {
    conds.push('status = ?');
    params.push(status);
  }
  if (search) {
    conds.push('(name LIKE ? OR phone LIKE ?)');
    const kw = `%${search}%`;
    params.push(kw, kw);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (await db.prepare(`SELECT COUNT(*) as c FROM leads ${where}`).get(...params) as { c: number }).c;
  const rows = await db.prepare(`SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as LeadRow[];
  return paginate(rows, total, page, limit);
}
