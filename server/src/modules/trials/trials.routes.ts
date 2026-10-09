import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { listTrials, TRIAL_STATUS, convertTrial } from './trials.service';

const router = Router();

/** Danh sách đăng ký học thử */
router.get(
  '/',
  requirePermission('trials.view'),
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
    res.json(await listTrials(reqCenterId(req), { status }, { page, limit }));
  })
);

/** Cập nhật trạng thái */
router.put(
  '/:id',
  requirePermission('trials.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const { status } = req.body as { status?: string };
    if (!status || !(TRIAL_STATUS as readonly string[]).includes(status)) {
      res.status(400).json({ error: 'Trạng thái không hợp lệ' });
      return;
    }
    const trial = (await db.prepare('SELECT id, center_id FROM trial_registrations WHERE id = ?').get(id)) as
      { id: number; center_id: number | null } | undefined;
    if (!trial || (cid !== null && trial.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy đăng ký học thử' });
      return;
    }
    await db.prepare('UPDATE trial_registrations SET status = ? WHERE id = ?').run(status, id);
    res.json(await db.prepare('SELECT * FROM trial_registrations WHERE id = ?').get(id));
  })
);

/** Chuyển đăng ký học thử thành học viên chính thức */
router.post(
  '/:id/convert',
  requirePermission('trials.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const { class_id } = req.body as { class_id?: number };
    // convertTrial ném 404 (không tồn tại/khác center) hoặc 409 (đã convert)
    res.status(201).json({ ok: true, ...(await convertTrial(cid, id, class_id ?? null)) });
  })
);

export default router;
