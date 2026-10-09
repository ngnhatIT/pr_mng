import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { paramId } from '../../shared/validate';
import { listLeads, LEAD_STATUS, convertLeadToStudent } from './leads.service';

const router = Router();
router.use(requirePermission('leads.view'));

interface LeadRow {
  id: number;
  center_id: number | null;
  name: string;
  phone: string;
  source: string | null;
  status: string;
  note: string | null;
}

/** Lấy lead và kiểm tra thuộc trung tâm của user */
async function getLead(id: number, cid: number | null): Promise<LeadRow | undefined> {
  const row = (await db.prepare('SELECT * FROM leads WHERE id = ?').get(id)) as LeadRow | undefined;
  if (!row) return undefined;
  if (cid !== null && row.center_id !== cid) return undefined;
  return row;
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
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const phone = String(body?.phone ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Tên khách hàng là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Số điện thoại là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const status =
      body?.status && (LEAD_STATUS as readonly string[]).includes(String(body.status))
        ? String(body.status)
        : 'new';
    const source = body?.source ? String(body.source).trim() : null;
    const note = body?.note ? String(body.note).trim() : null;
    const r = await db
      .prepare('INSERT INTO leads (center_id, name, phone, source, status, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cid, name, phone, source, status, note);
    const row = await db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(row);
  })
);

/* ------------------------- Cập nhật lead ------------------------- */

// PUT /api/leads/:id
router.put(
  '/:id',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const lead = await getLead(id, cid);
    if (!lead) {
      res.status(404).json({ error: 'Không tìm thấy lead', code: 'NOT_FOUND' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'Tên khách hàng không được để trống', code: 'BAD_REQUEST' });
        return;
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (body?.phone !== undefined) {
      const phone = String(body.phone).trim();
      if (!phone) {
        res.status(400).json({ error: 'Số điện thoại không được để trống', code: 'BAD_REQUEST' });
        return;
      }
      sets.push('phone = ?');
      params.push(phone);
    }
    if (body?.source !== undefined) {
      sets.push('source = ?');
      params.push(body.source ? String(body.source).trim() : null);
    }
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!(LEAD_STATUS as readonly string[]).includes(status)) {
        res.status(400).json({ error: 'Trạng thái không hợp lệ', code: 'VALIDATION_INVALID' });
        return;
      }
      sets.push('status = ?');
      params.push(status);
    }
    if (body?.note !== undefined) {
      sets.push('note = ?');
      params.push(body.note ? String(body.note).trim() : null);
    }
    if (sets.length > 0) {
      await db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    }
    const row = await db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    res.json(row);
  })
);

/* ------------------------- Xóa lead ------------------------- */

// DELETE /api/leads/:id
router.delete(
  '/:id',
  requirePermission('leads.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    const lead = await getLead(id, cid);
    if (!lead) {
      res.status(404).json({ error: 'Không tìm thấy lead', code: 'NOT_FOUND' });
      return;
    }
    await db.prepare('DELETE FROM leads WHERE id = ?').run(id);
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
      leadId: Number(req.params.id),
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
