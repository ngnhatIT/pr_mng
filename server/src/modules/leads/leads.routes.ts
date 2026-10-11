import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { paramId, validate, v } from '../../shared/validate';
import { listLeads, convertLeadToStudent, createLead, updateLead, deleteLead } from './leads.service';
import { actorFromReq } from '../../shared/audit';

const router = Router();
router.use(requirePermission('leads.view'));

/** V-1: chặn chuỗi quá dài ở form staff (form công khai đã cắt). Chỉ kiểm tra độ dài, logic giữ ở service. */
function capLeadFields(body: unknown): void {
  validate(body, {
    name: v.string({ max: 100, label: 'Tên khách hàng' }),
    phone: v.string({ max: 20, label: 'Số điện thoại' }),
    source: v.string({ max: 100, label: 'Nguồn' }),
    note: v.string({ max: 1000, label: 'Ghi chú' }),
  });
}

/* ------------------------- Danh sách lead ------------------------- */

// GET /api/leads?status=&search=&page=&limit=
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      status = '',
      search = '',
      page,
      limit,
    } = req.query as {
      status?: string;
      search?: string;
      page?: string;
      limit?: string;
    };
    res.json(await listLeads(reqCenterId(req), { status, search }, { page, limit }));
  })
);

/* ------------------------- Tạo lead ------------------------- */

// POST /api/leads
router.post(
  '/',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    if (cid === null) {
      res.status(400).json({ error: 'Thiếu thông tin trung tâm', code: 'BAD_REQUEST' });
      return;
    }
    capLeadFields(req.body);
    res.status(201).json(await createLead(cid, req.body as Record<string, unknown> | undefined));
  })
);

/* ------------------------- Cập nhật lead ------------------------- */

// PUT /api/leads/:id
router.put(
  '/:id',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    capLeadFields(req.body);
    res.json(await updateLead(reqCenterId(req), id, req.body as Record<string, unknown> | undefined));
  })
);

/* ------------------------- Xóa lead ------------------------- */

// DELETE /api/leads/:id
router.delete(
  '/:id',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteLead(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

/* ------------------------- Chuyển lead thành học viên ------------------------- */

// POST /api/leads/:id/convert { class_id? }
router.post(
  '/:id/convert',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    const rawClassId = body?.class_id;
    const result = await convertLeadToStudent({
      leadId: paramId(req.params),
      centerId: reqCenterId(req),
      classId:
        rawClassId !== undefined && rawClassId !== null && String(rawClassId).trim() !== ''
          ? Number(rawClassId)
          : null,
    });
    res.status(201).json({ ok: true, ...result });
  })
);

export default router;
