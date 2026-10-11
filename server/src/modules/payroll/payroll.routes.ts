import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { actorFromReq } from '../../shared/audit';
import { validate, v } from '../../shared/validate';
import {
  calcPayrollBulk,
  currentMonth,
  assertValidMonth,
  setSalaryRule,
  setPayrollClosed,
  listPayrollClosures,
} from './payroll.service';

const router = Router();

/** Bảng lương tháng (staff) */
router.get(
  '/',
  requirePermission('payroll.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const q = String((req.query as { month?: string }).month || '');
    const month = q ? (assertValidMonth(q), q) : currentMonth();
    // 1 query duy nhất cho cả bảng lương (trước đây 1 + N query)
    res.json(await calcPayrollBulk(reqCenterId(req), month));
  })
);

/** Lưu định mức lương theo buổi (admin) — effective_from tùy chọn (mặc định hôm nay, giờ VN) */
router.put(
  '/rules',
  requirePermission('payroll.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      teacher_id: v.number({ required: true, integer: true, label: 'Giáo viên' }),
      per_session_amount: v.number({ required: true, label: 'Số tiền mỗi buổi' }),
      effective_from: v.date({ label: 'Ngày hiệu lực' }),
    });
    await setSalaryRule(reqCenterId(req), input, actorFromReq(req));
    res.json({ ok: true });
  })
);

/** J-A8: các tháng lương đã chốt */
router.get(
  '/closures',
  requirePermission('payroll.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await listPayrollClosures(reqCenterId(req)));
  })
);

/** J-A8: chốt tháng lương (409 PAYROLL_CLOSED cho mọi sửa đơn giá/điểm danh/hủy buổi thuộc tháng đó) */
router.post(
  '/closures',
  requirePermission('payroll.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { month } = validate(req.body, { month: v.string({ required: true, label: 'Tháng' }) });
    await setPayrollClosed(requireCenterId(req), month, true, actorFromReq(req));
    res.json({ ok: true });
  })
);

/** J-A8: mở lại tháng lương đã chốt (có audit) */
router.delete(
  '/closures/:month',
  requirePermission('payroll.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await setPayrollClosed(requireCenterId(req), String(req.params.month), false, actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
