import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export interface ReferralRow {
  id: number;
  referrer_name?: string;
  referrer_phone?: string;
  referred_phone?: string;
  referred_student_name?: string | null;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface ReferralQuery {
  status?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách giới thiệu (có phân trang). Scope center qua phụ huynh giới thiệu. */
export async function listReferrals(
  centerId: number | null,
  query: ReferralQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<ReferralRow>> {
  const { status = '' } = query;
  // Validate status (tránh typo trả toàn bộ lặng lẽ)
  const VALID_STATUS = ['pending', 'rewarded'];
  if (status && !VALID_STATUS.includes(status)) {
    throw AppError.badRequest('Trạng thái không hợp lệ');
  }
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('p.center_id = ?');
    params.push(centerId);
  }
  if (status) {
    conds.push('rf.status = ?');
    params.push(status);
  }
  const from = `FROM referrals rf
       JOIN parents p ON p.id = rf.referrer_parent_id
       LEFT JOIN students s ON s.id = rf.referred_student_id`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  const rows = (await db
    .prepare(
      `SELECT rf.id, p.name as referrer_name, p.phone as referrer_phone,
         rf.referred_phone, s.name as referred_student_name,
         rf.status, rf.created_at
       ${from} ${where}
       ORDER BY rf.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as ReferralRow[];
  return paginate(rows, total, page, limit);
}
