import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

export interface AuditLogRow {
  id: number;
  center_id: number | null;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  summary: string;
  meta: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditFilter {
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
}

/** Danh sách audit log — admin xem (superadmin thấy tất cả). */
export async function listAuditLogs(
  centerId: number | null,
  filter: AuditFilter,
  pageOpts: PageOptions = {}
): Promise<Paginated<AuditLogRow>> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  if (filter.action) {
    conds.push('action = ?');
    params.push(filter.action);
  }
  if (filter.entity) {
    conds.push('entity = ?');
    params.push(filter.entity);
  }
  if (filter.from) {
    conds.push('date(created_at) >= date(?)');
    params.push(filter.from);
  }
  if (filter.to) {
    conds.push('date(created_at) <= date(?)');
    params.push(filter.to);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM audit_logs ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as AuditLogRow[];
  return paginate(rows, total, page, limit);
}
