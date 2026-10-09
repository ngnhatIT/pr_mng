import { Router, Response } from 'express';
import { nowVNSql } from '../../shared/vnTime';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { notifyParents } from '../../services/notify';
import { logger } from '../../shared/logger';
import { asyncHandler } from '../../shared/http';
import { listLeaves } from './leaves.service';

const log = logger.scope('leaves');

const router = Router();

/** Danh sách đơn xin nghỉ (staff) */
router.get(
  '/',
  requirePermission('leaves.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      status = '',
      page,
      limit,
    } = req.query as {
      status?: string;
      page?: string;
      limit?: string;
    };
    res.json(await listLeaves(reqCenterId(req), { status }, { page, limit }));
  })
);

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

/** Duyệt đơn xin nghỉ (staff) — kèm gợi ý buổi học bù */
router.post(
  '/:id/approve',
  requirePermission('leaves.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const leave = await getLeave(id);
    if (!leave || (cid !== null && leave.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đơn xin nghỉ', code: 'NOT_FOUND' });
      return;
    }
    const now = nowVNSql();
    // Chỉ duyệt đơn đang pending — đơn đã xử lý thì báo 409
    const upd = await db
      .prepare(
        "UPDATE leave_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(req.user!.id, now, id);
    if ((upd.changes ?? 0) !== 1) {
      res.status(409).json({ error: 'Đơn xin nghỉ đã được xử lý trước đó', code: 'BAD_REQUEST' });
      return;
    }
    // Gợi ý học bù: các buổi BỊ MISS trong khoảng nghỉ [from_date, to_date]
    // (không phải mọi buổi tương lai — học viên vốn sẽ học các buổi đó)
    let suggestions: { session_id: number; date: string; topic: string | null }[] = [];
    if (leave.class_id) {
      suggestions = (await db
        .prepare(
          `SELECT s.id as session_id, s.date, s.topic
         FROM sessions s
         WHERE s.class_id = ? AND s.date >= ? AND s.date <= ?
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.student_id = ?)
         ORDER BY s.date ASC LIMIT 5`
        )
        .all(leave.class_id, leave.from_date, leave.to_date, leave.student_id)) as typeof suggestions;
    }
    await notifyParents(
      leave.student_id,
      'leave_result',
      `Đơn xin nghỉ từ ${leave.from_date} đến ${leave.to_date} của học viên ${leave.student_name} đã được duyệt.`,
      null
    ).catch((err) => log.warn('notifyParents failed', { error: String(err) }));
    res.json({ ok: true, suggestions });
  })
);

/** Từ chối đơn xin nghỉ (staff) */
router.post(
  '/:id/reject',
  requirePermission('leaves.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const leave = await getLeave(id);
    if (!leave || (cid !== null && leave.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đơn xin nghỉ', code: 'NOT_FOUND' });
      return;
    }
    const now = nowVNSql();
    const upd = await db
      .prepare(
        "UPDATE leave_requests SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(req.user!.id, now, id);
    if ((upd.changes ?? 0) !== 1) {
      res.status(409).json({ error: 'Đơn xin nghỉ đã được xử lý trước đó', code: 'BAD_REQUEST' });
      return;
    }
    await notifyParents(
      leave.student_id,
      'leave_result',
      `Đơn xin nghỉ từ ${leave.from_date} đến ${leave.to_date} của học viên ${leave.student_name} đã bị từ chối. Vui lòng liên hệ trung tâm để biết thêm chi tiết.`,
      null
    ).catch((err) => log.warn('notifyParents failed', { error: String(err) }));
    res.json({ ok: true });
  })
);

export default router;
