import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { AppError } from '../../shared/errors';
import { nowVNSql } from '../../shared/vnTime';
import { audit, type AuditActor } from '../../shared/audit';
import { notifyParents } from '../../services/notify';
import { logger } from '../../shared/logger';

const log = logger.scope('leaves');

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
  // Validate status (tránh typo trả toàn bộ lặng lẽ)
  if (status && !(LEAVE_STATUS as readonly string[]).includes(status)) {
    throw AppError.badRequest('Trạng thái không hợp lệ');
  }
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

async function getLeave(id: number) {
  return (await db
    .prepare(
      `SELECT lr.*, s.name as student_name, s.center_id
       FROM leave_requests lr JOIN students s ON s.id = lr.student_id
       WHERE lr.id = ?`
    )
    .get(id)) as
    | {
        id: number;
        student_id: number;
        class_id: number | null;
        from_date: string;
        to_date: string;
        status: string;
        student_name: string;
        center_id: number | null;
      }
    | undefined;
}

export type LeaveSuggestion = { session_id: number; date: string; topic: string | null };

/**
 * Duyệt / từ chối đơn xin nghỉ (staff). Chỉ đơn đang pending — đơn đã xử lý thì 409.
 * Duyệt: trả kèm gợi ý học bù (các buổi BỊ MISS trong khoảng nghỉ).
 */
export async function decideLeave(
  centerId: number | null,
  id: number,
  decision: 'approved' | 'rejected',
  actor: AuditActor
): Promise<{ ok: true; suggestions?: LeaveSuggestion[] }> {
  const leave = await getLeave(id);
  if (!leave || (centerId !== null && leave.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy đơn xin nghỉ');
  }
  const upd = await db
    .prepare(
      "UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
    )
    .run(decision, actor.id ?? null, nowVNSql(), id);
  if ((upd.changes ?? 0) !== 1) throw AppError.conflict('Đơn xin nghỉ đã được xử lý trước đó');
  const approved = decision === 'approved';
  const range = `${leave.from_date} → ${leave.to_date}`;
  await audit({
    centerId: leave.center_id,
    actor,
    action: approved ? 'approve' : 'reject',
    entity: 'leave_requests',
    entityId: id,
    summary: `${approved ? 'Duyệt' : 'Từ chối'} đơn nghỉ của ${leave.student_name} (${range})`,
  });
  const head = `Đơn xin nghỉ từ ${leave.from_date} đến ${leave.to_date} của học viên ${leave.student_name}`;
  const msg = approved
    ? `${head} đã được duyệt.`
    : `${head} đã bị từ chối. Vui lòng liên hệ trung tâm để biết thêm chi tiết.`;
  if (!approved) {
    await notifyParents(leave.student_id, 'leave_result', msg, null).catch((err) =>
      log.warn('notifyParents failed', { error: String(err) })
    );
    return { ok: true };
  }
  // Gợi ý học bù: các buổi BỊ MISS trong khoảng nghỉ [from_date, to_date]
  // (không phải mọi buổi tương lai — học viên vốn sẽ học các buổi đó)
  let suggestions: LeaveSuggestion[] = [];
  if (leave.class_id) {
    suggestions = (await db
      .prepare(
        `SELECT s.id as session_id, s.date, s.topic
         FROM sessions s
         WHERE s.class_id = ? AND s.date >= ? AND s.date <= ? AND s.status <> 'cancelled'
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.student_id = ?)
         ORDER BY s.date ASC LIMIT 5`
      )
      .all(leave.class_id, leave.from_date, leave.to_date, leave.student_id)) as LeaveSuggestion[];
  }
  await notifyParents(leave.student_id, 'leave_result', msg, null).catch((err) =>
    log.warn('notifyParents failed', { error: String(err) })
  );
  return { ok: true, suggestions };
}
