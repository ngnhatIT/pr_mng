import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';

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
export async function listReviews(
  centerId: number | null,
  query: ReviewQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<ReviewRow>> {
  const { status = '' } = query;
  // Validate status (tránh typo trả rỗng lặng lẽ)
  const VALID_STATUS = ['pending', 'approved', 'rejected'];
  if (status && !VALID_STATUS.includes(status)) {
    throw AppError.badRequest('Trạng thái không hợp lệ');
  }
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
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  const rows = (await db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at,
         p.name as parent_name, p.phone as parent_phone
       ${from} ${where}
       ORDER BY r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as ReviewRow[];
  return paginate(rows, total, page, limit);
}

/** Lấy review và kiểm tra thuộc trung tâm của user (404 nếu không). */
async function getScopedReview(id: number, centerId: number | null) {
  const row = (await db.prepare('SELECT * FROM reviews WHERE id = ?').get(id)) as
    { id: number; center_id: number | null } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId))
    throw AppError.notFound('Không tìm thấy đánh giá');
  return row;
}

/** Duyệt / từ chối đánh giá. */
export async function setReviewStatus(
  centerId: number | null,
  id: number,
  status: 'approved' | 'rejected',
  actor: AuditActor
) {
  const review = await getScopedReview(id, centerId);
  await db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id);
  const approved = status === 'approved';
  await audit({
    centerId: review.center_id,
    actor,
    action: approved ? 'approve' : 'reject',
    entity: 'reviews',
    entityId: id,
    summary: `${approved ? 'Duyệt' : 'Từ chối'} đánh giá #${id}`,
  });
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
}

export async function deleteReview(centerId: number | null, id: number, actor: AuditActor): Promise<void> {
  const review = await getScopedReview(id, centerId);
  await db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  await audit({
    centerId: review.center_id,
    actor,
    action: 'delete',
    entity: 'reviews',
    entityId: id,
    summary: `Xóa đánh giá #${id}`,
  });
}
