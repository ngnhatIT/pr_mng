import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as invoiceService from './invoices.service';
import { actorFromReq } from '../../shared/audit';

const router = Router();

router.get(
  '/',
  requirePermission('invoices.view'),
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
  requirePermission('invoices.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await invoiceService.getDebtReport(reqCenterId(req), { page, limit }));
  })
);

/** Tổng quan công nợ (không phân trang) — cho header/tổng số. */
router.get(
  '/debt-summary',
  requirePermission('invoices.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await invoiceService.getDebtSummary(reqCenterId(req)));
  })
);

router.get(
  '/:id',
  requirePermission('invoices.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await invoiceService.getInvoiceDetail(reqCenterId(req), paramId(req.params)));
  })
);

router.post(
  '/',
  requirePermission('invoices.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      student_id: v.number({ required: true, integer: true, label: 'Học viên' }),
      class_id: v.number({ integer: true, label: 'Lớp học' }),
      amount: v.number({ required: true, label: 'Số tiền' }),
      due_date: v.string({ label: 'Hạn nộp' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
    });
    const created = await invoiceService.createInvoice(
      reqCenterId(req),
      {
        student_id: input.student_id,
        class_id: input.class_id ?? undefined,
        amount: input.amount,
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
  requirePermission('invoices.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      amount: v.number({ required: true, label: 'Số tiền' }),
      due_date: v.string({ label: 'Hạn nộp' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
    });
    res.json(
      await invoiceService.updateInvoice(
        reqCenterId(req),
        paramId(req.params),
        {
          amount: input.amount,
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
  requirePermission('invoices.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await invoiceService.deleteInvoice(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

// Thu tiền cho phiếu thu
router.post(
  '/:id/payments',
  requirePermission('payments.collect'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      amount: v.number({ required: true, label: 'Số tiền' }),
      method: v.string({ max: 50, label: 'Hình thức' }),
      note: v.string({ max: 500, label: 'Ghi chú' }),
      paid_at: v.string({ label: 'Ngày thu' }),
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

// Áp dụng credits của phụ huynh để trừ tiền hóa đơn
router.post(
  '/:id/apply-credit',
  requirePermission('payments.collect'),
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
    res.json({ ok: true, applied: result.applied, status: result.status });
  })
);

export default router;
