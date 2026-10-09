import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v } from '../../shared/validate';
import { effTeacherId, getTodaySessions, checkinByCode, getMyPayroll } from './teacher.service';

const router = Router();

/** Portal giáo viên — phân quyền theo permission (teacher: scope own; admin/superadmin: full). */

/** Các buổi dạy hôm nay */
router.get(
  '/today',
  requirePermission('sessions.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = await effTeacherId(req);
    if (!tid) {
      res.status(403).json({ error: 'Tài khoản chưa gắn với giáo viên nào', code: 'BAD_REQUEST' });
      return;
    }
    res.json(await getTodaySessions(tid));
  })
);

/** Giáo viên điểm danh bằng mã check-in của buổi học */
router.post(
  '/checkin',
  requirePermission('attendance.take'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = req.user?.teacher_id;
    if (!tid) {
      res.status(400).json({ error: 'Tài khoản chưa gắn với giáo viên nào', code: 'BAD_REQUEST' });
      return;
    }
    const { code } = validate(req.body, {
      code: v.string({ required: true, label: 'Mã điểm danh' }),
    });
    const result = await checkinByCode(tid, code);
    res.status(201).json({ ok: true, ...result });
  })
);

/** Bảng lương của chính giáo viên */
router.get(
  '/payroll',
  requirePermission('payroll.view_self'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const tid = await effTeacherId(req);
    if (!tid) {
      res.status(403).json({ error: 'Tài khoản chưa gắn với giáo viên nào', code: 'BAD_REQUEST' });
      return;
    }
    const q = String((req.query as { month?: string }).month || '');
    res.json(await getMyPayroll(tid, q));
  })
);

export default router;
