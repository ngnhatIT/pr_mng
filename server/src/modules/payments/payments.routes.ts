import { Router, Response } from 'express';
import { AuthRequest, requireAuth, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as paymentService from './payments.service';
import { actorFromReq } from '../../shared/audit';

const router = Router();

/**
 * VNPay return URL — PUBLIC (VNPay gọi về, không có token).
 * Định nghĩa TRƯỚC router.use(requireAuth).
 */
router.get('/vnpay-return', async (req: AuthRequest, res: Response) => {
  const redirectUrl = await paymentService.handleVnpayReturn(
    req.query as Record<string, string | string[] | undefined>
  );
  res.redirect(redirectUrl);
});

/* --------------------- Từ đây yêu cầu đăng nhập --------------------- */
router.use(requireAuth);

/** Các khoản phụ huynh báo đã chuyển khoản, chờ nhân viên duyệt (staff) */
router.get(
  '/pending',
  requirePermission('payments.approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await paymentService.listPendingPayments(reqCenterId(req), { page, limit }));
  })
);

/** Duyệt khoản thanh toán chờ (staff) */
router.post(
  '/pending/:id/approve',
  requirePermission('payments.approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status } = await paymentService.approvePendingPayment(paramId(req.params), actorFromReq(req));
    res.json({ ok: true, status });
  })
);

/** Từ chối khoản thanh toán chờ (staff) */
router.post(
  '/pending/:id/reject',
  requirePermission('payments.approve'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    paymentService.rejectPendingPayment(paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

/** Xem cấu hình thanh toán (admin) — hashsecret được che */
router.get(
  '/config',
  requirePermission('payment_config.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await paymentService.getPaymentConfig(reqCenterId(req)));
  })
);

/** Lưu cấu hình thanh toán (admin) */
router.put(
  '/config',
  requirePermission('payment_config.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = validate(req.body, {
      pay_bank_code: v.string({ max: 20, label: 'Mã ngân hàng' }),
      pay_bank_account_no: v.string({ max: 30, label: 'Số tài khoản' }),
      pay_bank_account_name: v.string({ max: 100, label: 'Tên tài khoản' }),
      pay_vnp_tmncode: v.string({ max: 50, label: 'VNPay TMN Code' }),
      pay_vnp_enabled: v.string({ label: 'Bật VNPay' }),
      pay_vnp_hashsecret: v.string({ max: 100, label: 'VNPay Hash Secret' }),
      referral_reward_referrer: v.number({ min: 0, label: 'Thưởng người giới thiệu' }),
      referral_reward_referred: v.number({ min: 0, label: 'Thưởng người được giới thiệu' }),
    });
    paymentService.savePaymentConfig(reqCenterId(req), body as Record<string, unknown>);
    res.json({ ok: true });
  })
);

export default router;
