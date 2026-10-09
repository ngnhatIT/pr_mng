import { Router, Response } from 'express';
import { db, toISODate } from '../../db';
import { AuthRequest, staffOnly, reqCenterId } from '../../middleware/auth';
import { notifyParents } from '../../services/notify';
import { asyncHandler } from '../../shared/http';
import { listLeaves } from './leaves.service';

const router = Router();

/** Danh sách đơn xin nghỉ (staff) */
router.get(
  '/',
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
    res.json(listLeaves(reqCenterId(req), { status }, { page, limit }));
  })
);

function getLeave(id: number) {
  return db
    .prepare(
      `SELECT lr.*, s.name as student_name, s.center_id
       FROM leave_requests lr JOIN students s ON s.id = lr.student_id
       WHERE lr.id = ?`
    )
    .get(id) as
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
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const leave = getLeave(id);
    if (!leave || (cid !== null && leave.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đơn xin nghỉ' });
      return;
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(
      "UPDATE leave_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?"
    ).run(req.user!.id, now, id);
    // Gợi ý học bù: các buổi từ hôm nay trở đi mà học viên chưa có điểm danh
    let suggestions: { session_id: number; date: string; topic: string | null }[] = [];
    if (leave.class_id) {
      const today = toISODate(new Date());
      suggestions = db
        .prepare(
          `SELECT s.id as session_id, s.date, s.topic
         FROM sessions s
         WHERE s.class_id = ? AND s.date >= ?
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.student_id = ?)
         ORDER BY s.date ASC LIMIT 5`
        )
        .all(leave.class_id, today, leave.student_id) as typeof suggestions;
    }
    notifyParents(
      leave.student_id,
      'leave_result',
      `Đơn xin nghỉ từ ${leave.from_date} đến ${leave.to_date} của học viên ${leave.student_name} đã được duyệt.`,
      null
    );
    res.json({ ok: true, suggestions });
  })
);

/** Từ chối đơn xin nghỉ (staff) */
router.post(
  '/:id/reject',
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const leave = getLeave(id);
    if (!leave || (cid !== null && leave.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đơn xin nghỉ' });
      return;
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(
      "UPDATE leave_requests SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?"
    ).run(req.user!.id, now, id);
    notifyParents(
      leave.student_id,
      'leave_result',
      `Đơn xin nghỉ từ ${leave.from_date} đến ${leave.to_date} của học viên ${leave.student_name} đã bị từ chối. Vui lòng liên hệ trung tâm để biết thêm chi tiết.`,
      null
    );
    res.json({ ok: true });
  })
);

export default router;
