import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { getPermissionScope } from '../authorization/authorization.service';
import { asyncHandler } from '../../shared/http';
import { getDashboard } from './dashboard.service';

const router = Router();

router.get(
  '/',
  requirePermission('reports.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Scope 'own' (giáo viên hoặc custom role): chỉ số liệu các lớp mình dạy, không xem tài chính.
    // Chưa gắn teacher_id -> không thấy gì (fail-closed).
    const own = (await getPermissionScope(req.user!.id, 'reports.view')) === 'own';
    const tid = own ? (req.user?.teacher_id ?? 0) : null;
    res.json(await getDashboard(reqCenterId(req), tid, own));
  })
);

export default router;
