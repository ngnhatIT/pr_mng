import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { listReferrals } from './referrals.service';

const router = Router();
router.use(requirePermission('referrals.view'));

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
    const cid = reqCenterId(req);
    const centerFilter = cid !== null ? 'AND p.center_id = ?' : '';
    const params: unknown[] = cid !== null ? [cid] : [];
    const total = (
      (await db
        .prepare(
          `SELECT COUNT(*) as c FROM referrals rf
         JOIN parents p ON p.id = rf.referrer_parent_id
         WHERE 1 = 1 ${centerFilter}`
        )
        .get(...params)) as { c: number }
    ).c;
    const pending = (
      (await db
        .prepare(
          `SELECT COUNT(*) as c FROM referrals rf
         JOIN parents p ON p.id = rf.referrer_parent_id
         WHERE rf.status = 'pending' ${centerFilter}`
        )
        .get(...params)) as { c: number }
    ).c;
    const rewarded = (
      (await db
        .prepare(
          `SELECT COUNT(*) as c FROM referrals rf
         JOIN parents p ON p.id = rf.referrer_parent_id
         WHERE rf.status = 'rewarded' ${centerFilter}`
        )
        .get(...params)) as { c: number }
    ).c;
    const totalReward = (
      (await db
        .prepare(
          `SELECT COALESCE(SUM(c.amount), 0) as total FROM credits c
         JOIN parents p ON p.id = c.parent_id
         WHERE c.reason LIKE 'Thưởng giới thiệu%' ${centerFilter}`
        )
        .get(...params)) as { total: number }
    ).total;
    res.json({ total, pending, rewarded, total_reward: totalReward });
  })
);

export default router;
