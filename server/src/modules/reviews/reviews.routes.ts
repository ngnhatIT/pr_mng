import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { paramId } from '../../shared/validate';
import { actorFromReq } from '../../shared/audit';
import { listReviews, setReviewStatus, deleteReview } from './reviews.service';

const router = Router();
router.use(requirePermission('reviews.view'));

/* ------------------------- Danh sách đánh giá ------------------------- */

// GET /api/reviews?status=&page=&limit=
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
    res.json(await listReviews(reqCenterId(req), { status }, { page, limit }));
  })
);

/* ------------------------- Duyệt / từ chối đánh giá ------------------------- */

// POST /api/reviews/:id/approve
router.post(
  '/:id/approve',
  requirePermission('reviews.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await setReviewStatus(reqCenterId(req), paramId(req.params), 'approved', actorFromReq(req)));
  })
);

// POST /api/reviews/:id/reject
router.post(
  '/:id/reject',
  requirePermission('reviews.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await setReviewStatus(reqCenterId(req), paramId(req.params), 'rejected', actorFromReq(req)));
  })
);

/* ------------------------- Xóa đánh giá ------------------------- */

// DELETE /api/reviews/:id
router.delete(
  '/:id',
  requirePermission('reviews.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteReview(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
