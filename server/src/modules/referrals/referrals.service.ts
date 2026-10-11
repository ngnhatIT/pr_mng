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

/** Danh sách giới thiệu (có phân trang). Scope theo referrals.center_id (REF-1). */
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
    conds.push('rf.center_id = ?');
    params.push(centerId);
  }
  if (status) {
    conds.push('rf.status = ?');
    params.push(status);
  }
  const from = `FROM referrals rf
       JOIN parents p ON p.id = rf.referrer_parent_id
       LEFT JOIN students s ON s.id = rf.referred_student_id AND s.center_id = rf.center_id`;
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

/**
 * Thống kê giới thiệu. REF-3: scope theo center của referral/credit (không theo parents.center_id);
 * tổng thưởng gồm cả credits phía người giới thiệu lẫn người được giới thiệu, trừ credits đã thu hồi.
 */
export async function getReferralStats(
  centerId: number | null
): Promise<{ total: number; pending: number; rewarded: number; total_reward: number }> {
  const params: unknown[] = centerId !== null ? [centerId] : [];
  const [counts, totalReward] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE rf.status = 'pending') as pending,
                COUNT(*) FILTER (WHERE rf.status = 'rewarded') as rewarded
         FROM referrals rf
         ${centerId !== null ? 'WHERE rf.center_id = ?' : ''}`
      )
      .get(...params) as Promise<{ total: number; pending: number; rewarded: number }>,
    db
      .prepare(
        `SELECT COALESCE(SUM(c.amount), 0) as total FROM credits c
         WHERE (c.reason LIKE 'Thưởng giới thiệu%' OR c.reason LIKE 'Ưu đãi học viên được giới thiệu%')
           AND c.voided_at IS NULL
         ${centerId !== null ? 'AND c.center_id = ?' : ''}`
      )
      .get(...params) as Promise<{ total: number }>,
  ]);
  return {
    total: Number(counts.total),
    pending: Number(counts.pending),
    rewarded: Number(counts.rewarded),
    total_reward: Number(totalReward.total),
  };
}
