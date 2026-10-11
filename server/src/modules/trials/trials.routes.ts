import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { paramId } from '../../shared/validate';
import { listTrials, TRIAL_STATUS, convertTrial, updateTrialStatus } from './trials.service';
import { actorFromReq } from '../../shared/audit';

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
    const id = paramId(req.params);
    const { status } = req.body as { status?: string };
    if (!status || !(TRIAL_STATUS as readonly string[]).includes(status)) {
      res.status(400).json({ error: 'Trạng thái không hợp lệ', code: 'VALIDATION_INVALID' });
      return;
    }
    // Chặn set 'converted' trực tiếp qua PUT (phải dùng POST /:id/convert để tạo học viên)
    if (status === 'converted') {
      res.status(400).json({
        error: "Không thể chuyển trạng thái thành 'converted' trực tiếp, hãy dùng chức năng chuyển đổi",
        code: 'VALIDATION_INVALID',
      });
      return;
    }
    res.json(await updateTrialStatus(cid, id, status, actorFromReq(req)));
  })
);

/** Chuyển đăng ký học thử thành học viên chính thức */
router.post(
  '/:id/convert',
  requirePermission('trials.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const { class_id } = req.body as { class_id?: number };
    // convertTrial ném 404 (không tồn tại/khác center) hoặc 409 (đã convert)
    res.status(201).json({ ok: true, ...(await convertTrial(cid, id, class_id ?? null)) });
  })
);

export default router;
