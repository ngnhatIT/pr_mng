import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { listReviews } from './reviews.service';

const router = Router();
router.use(requirePermission('reviews.view'));

interface ReviewRow {
  id: number;
  center_id: number | null;
}

/** Lấy review và kiểm tra thuộc trung tâm của user */
async function getReview(id: number, cid: number | null): Promise<ReviewRow | undefined> {
  const row = (await db.prepare('SELECT * FROM reviews WHERE id = ?').get(id)) as ReviewRow | undefined;
  if (!row) return undefined;
  if (cid !== null && row.center_id !== cid) return undefined;
  return row;
}

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
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const review = await getReview(id, cid);
    if (!review) {
      res.status(404).json({ error: 'Không tìm thấy đánh giá', code: 'NOT_FOUND' });
      return;
    }
    await db.prepare("UPDATE reviews SET status = 'approved' WHERE id = ?").run(id);
    const row = await db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    res.json(row);
  })
);

// POST /api/reviews/:id/reject
router.post(
  '/:id/reject',
  requirePermission('reviews.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const review = await getReview(id, cid);
    if (!review) {
      res.status(404).json({ error: 'Không tìm thấy đánh giá', code: 'NOT_FOUND' });
      return;
    }
    await db.prepare("UPDATE reviews SET status = 'rejected' WHERE id = ?").run(id);
    const row = await db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    res.json(row);
  })
);

/* ------------------------- Xóa đánh giá ------------------------- */

// DELETE /api/reviews/:id
router.delete(
  '/:id',
  requirePermission('reviews.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const review = await getReview(id, cid);
    if (!review) {
      res.status(404).json({ error: 'Không tìm thấy đánh giá', code: 'NOT_FOUND' });
      return;
    }
    await db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

export default router;
