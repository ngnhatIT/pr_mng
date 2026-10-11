import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { AppError } from '../../shared/errors';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as invoiceService from './invoices.service';
import * as paymentService from '../payments/payments.service';
import { actorFromReq } from '../../shared/audit';
import { idempotency } from '../../middleware/idempotency';

// AUTHZ-1: service hóa đơn/thu tiền thao tác toàn trung tâm -> yêu cầu scope 'center' (không nhận 'own')
const router = Router();

/** Phần tiền chung của tạo/sửa hóa đơn (items là mảng tùy chọn; service kiểm tra từng dòng). */
function moneyOf(input: {
  amount?: number | null;
  items?: unknown;
  discount_amount?: number | null;
  discount_reason?: string | null;
  period?: string | null;
}) {
  if (input.items !== undefined && input.items !== null && !Array.isArray(input.items)) {
    throw AppError.badRequest('Dòng hóa đơn phải là danh sách', 'INVALID_ITEMS');
  }
  return {
    amount: input.amount ?? null,
    items: (input.items ?? undefined) as invoiceService.InvoiceLine[] | undefined,
    discount_amount: input.discount_amount ?? 0,
    discount_reason: input.discount_reason ?? null,
    period: input.period || null,
  };
}

// Tạo hóa đơn học phí tháng hàng loạt (dry_run=true để xem trước)
router.post(
  '/bulk',
  requirePermission('invoices.create', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      period: v.string({ required: true, max: 7, label: 'Kỳ thu' }),
      class_id: v.number({ integer: true, min: 1, label: 'Lớp học' }),
      due_date: v.date({ label: 'Hạn nộp' }),
      lang: v.string({ max: 2, label: 'Ngôn ngữ' }),
      dry_run: v.boolean({ label: 'Xem trước' }),
    });
    res.json(
      await invoiceService.generateMonthlyInvoices(
        requireCenterId(req),
        {
          period: input.period,
          class_id: input.class_id ?? null,
          due_date: input.due_date ?? null,
          lang: input.lang === 'en' ? 'en' : 'vi',
          dry_run: input.dry_run === true,
        },
        actorFromReq(req)
      )
    );
  })
);

router.get(
  '/',
  requirePermission('invoices.view', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status, search, page, limit } = req.query as {
      status?: string;
      search?: string;
      page?: string;
      limit?: string;
    };
    res.json(await invoiceService.listInvoices(reqCenterId(req), { status, search }, { page, limit }));
  })
);

// Công nợ: học viên còn nợ (chưa thanh toán hết)
router.get(
  '/debt',
  requirePermission('invoices.view', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await invoiceService.getDebtReport(reqCenterId(req), { page, limit }));
  })
);

/** Tổng quan công nợ (không phân trang) — cho header/tổng số. */
router.get(
  '/debt-summary',
  requirePermission('invoices.view', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await invoiceService.getDebtSummary(reqCenterId(req)));
  })
);

router.get(
  '/:id',
  requirePermission('invoices.view', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await invoiceService.getInvoiceDetail(reqCenterId(req), paramId(req.params)));
  })
);

router.post(
  '/',
  requirePermission('invoices.create', 'center'),
  idempotency,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      student_id: v.number({ required: true, integer: true, label: 'Học viên' }),
      class_id: v.number({ integer: true, label: 'Lớp học' }),
      amount: v.number({ label: 'Số tiền' }),
      items: v.any({ label: 'Dòng hóa đơn' }),
      discount_amount: v.number({ min: 0, label: 'Giảm trừ' }),
      discount_reason: v.string({ max: 200, label: 'Lý do giảm trừ' }),
      period: v.string({ max: 7, label: 'Kỳ thu' }),
      due_date: v.date({ label: 'Hạn nộp' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
    });
    const created = await invoiceService.createInvoice(
      reqCenterId(req),
      {
        student_id: input.student_id,
        class_id: input.class_id ?? undefined,
        ...moneyOf(input),
        due_date: input.due_date ?? undefined,
        note: input.note ?? undefined,
      },
      actorFromReq(req)
    );
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  requirePermission('invoices.update', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      amount: v.number({ label: 'Số tiền' }),
      items: v.any({ label: 'Dòng hóa đơn' }),
      discount_amount: v.number({ min: 0, label: 'Giảm trừ' }),
      discount_reason: v.string({ max: 200, label: 'Lý do giảm trừ' }),
      period: v.string({ max: 7, label: 'Kỳ thu' }),
      due_date: v.date({ label: 'Hạn nộp' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
    });
    res.json(
      await invoiceService.updateInvoice(
        reqCenterId(req),
        paramId(req.params),
        {
          ...moneyOf(input),
          due_date: input.due_date ?? undefined,
          note: input.note ?? undefined,
        },
        actorFromReq(req)
      )
    );
  })
);

router.delete(
  '/:id',
  requirePermission('invoices.delete', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await invoiceService.deleteInvoice(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

// Hoàn tiền cho phiếu thu (quyền payments.refund — permission đã có từ trước nhưng chưa có implementation)
router.post(
  '/:id/refund',
  requirePermission('payments.refund', 'center'),
  idempotency,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      amount: v.number({ required: true, min: 1, label: 'Số tiền hoàn' }),
      reason: v.string({ max: 500, label: 'Lý do hoàn tiền' }),
    });
    const result = await paymentService.refundInvoice(
      reqCenterId(req),
      paramId(req.params),
      { amount: input.amount, reason: input.reason ?? undefined },
      actorFromReq(req)
    );
    res.status(201).json({ ok: true, ...result });
  })
);

// Thu tiền cho phiếu thu
router.post(
  '/:id/payments',
  requirePermission('payments.collect', 'center'),
  idempotency,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      amount: v.number({ required: true, label: 'Số tiền' }),
      method: v.string({ max: 50, label: 'Hình thức' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
      paid_at: v.date({ label: 'Ngày thu' }),
    });
    const { status } = await invoiceService.recordPayment(
      reqCenterId(req),
      paramId(req.params),
      {
        amount: input.amount,
        method: input.method ?? undefined,
        note: input.note ?? undefined,
        paid_at: input.paid_at ?? undefined,
      },
      actorFromReq(req)
    );
    res.status(201).json({ ok: true, status });
  })
);

// Credits còn dùng được cho hóa đơn (ApplyCreditModal chọn từ danh sách thay vì nhập ID)
router.get(
  '/:id/credits',
  requirePermission('payments.collect', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await invoiceService.listInvoiceCredits(reqCenterId(req), paramId(req.params)));
  })
);

// Áp dụng credits của phụ huynh để trừ tiền hóa đơn
router.post(
  '/:id/apply-credit',
  requirePermission('payments.collect', 'center'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { credit_id } = validate(req.body, {
      credit_id: v.number({ required: true, integer: true, label: 'Credit' }),
    });
    const result = await invoiceService.applyCredit(
      reqCenterId(req),
      paramId(req.params),
      credit_id as number,
      actorFromReq(req)
    );
    res.status(201).json({ ok: true, applied: result.applied, status: result.status });
  })
);

export default router;
