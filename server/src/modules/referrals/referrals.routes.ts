import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { listReferrals, getReferralStats } from './referrals.service';

const router = Router();
router.use(requirePermission('referrals.view', 'center')); // AUTHZ-1: thống kê toàn trung tâm

/* ------------------------- Danh sách giới thiệu ------------------------- */

// GET /api/referrals?status=&page=&limit=
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
    res.json(await listReferrals(reqCenterId(req), { status }, { page, limit }));
  })
);

/* ------------------------- Thống kê giới thiệu ------------------------- */

// GET /api/referrals/stats
router.get(
  '/stats',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await getReferralStats(reqCenterId(req)));
  })
);

export default router;
