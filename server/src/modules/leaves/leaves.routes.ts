import { Router, Response } from 'express';
import { paramId } from '../../shared/validate';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { actorFromReq } from '../../shared/audit';
import { listLeaves, decideLeave } from './leaves.service';

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

/** Duyệt đơn xin nghỉ (staff) — kèm gợi ý buổi học bù */
router.post(
  '/:id/approve',
  requirePermission('leaves.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await decideLeave(reqCenterId(req), paramId(req.params), 'approved', actorFromReq(req)));
  })
);

/** Từ chối đơn xin nghỉ (staff) */
router.post(
  '/:id/reject',
  requirePermission('leaves.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await decideLeave(reqCenterId(req), paramId(req.params), 'rejected', actorFromReq(req)));
  })
);

export default router;
