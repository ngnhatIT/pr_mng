import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId, staffOnly } from '../../middleware/auth';
import { asyncHandler } from '../../shared/http';
import { listLeads, LEAD_STATUS } from './leads.service';

const router = Router();
router.use(staffOnly);

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
function getLead(id: number, cid: number | null): LeadRow | undefined {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
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
    res.json(listLeads(reqCenterId(req), { status, search }, { page, limit }));
  })
);

/* ------------------------- Tạo lead ------------------------- */

// POST /api/leads
router.post(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    if (cid === null) {
      res.status(400).json({ error: 'Thiếu thông tin trung tâm' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const name = String(body?.name ?? '').trim();
    const phone = String(body?.phone ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Tên khách hàng là bắt buộc' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Số điện thoại là bắt buộc' });
      return;
    }
    const status =
      body?.status && (LEAD_STATUS as readonly string[]).includes(String(body.status))
        ? String(body.status)
        : 'new';
    const source = body?.source ? String(body.source).trim() : null;
    const note = body?.note ? String(body.note).trim() : null;
    const r = db
      .prepare('INSERT INTO leads (center_id, name, phone, source, status, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cid, name, phone, source, status, note);
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(row);
  })
);

/* ------------------------- Cập nhật lead ------------------------- */

// PUT /api/leads/:id
router.put(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const lead = getLead(id, cid);
    if (!lead) {
      res.status(404).json({ error: 'Không tìm thấy lead' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'Tên khách hàng không được để trống' });
        return;
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (body?.phone !== undefined) {
      const phone = String(body.phone).trim();
      if (!phone) {
        res.status(400).json({ error: 'Số điện thoại không được để trống' });
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
        res.status(400).json({ error: 'Trạng thái không hợp lệ' });
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
      db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    }
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    res.json(row);
  })
);

/* ------------------------- Xóa lead ------------------------- */

// DELETE /api/leads/:id
router.delete(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const lead = getLead(id, cid);
    if (!lead) {
      res.status(404).json({ error: 'Không tìm thấy lead' });
      return;
    }
    db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

/* ------------------------- Chuyển lead thành học viên ------------------------- */

// POST /api/leads/:id/convert { class_id? }
router.post(
  '/:id/convert',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const lead = getLead(id, cid);
    if (!lead) {
      res.status(404).json({ error: 'Không tìm thấy lead' });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    let classId: number | null = null;
    if (body?.class_id !== undefined && body?.class_id !== null && String(body.class_id).trim() !== '') {
      classId = Number(body.class_id);
      if (!Number.isInteger(classId)) {
        res.status(400).json({ error: 'Lớp học không hợp lệ' });
        return;
      }
      const cls = db
        .prepare(`SELECT id FROM classes WHERE id = ?${cid !== null ? ' AND center_id = ?' : ''}`)
        .get(...(cid !== null ? [classId, cid] : [classId]));
      if (!cls) {
        res.status(400).json({ error: 'Lớp học không tồn tại' });
        return;
      }
    }
    const centerId = lead.center_id;
    if (centerId === null) {
      res.status(400).json({ error: 'Lead chưa gắn trung tâm' });
      return;
    }
    const code = `HV${Date.now().toString().slice(-6)}`;
    const r = db
      .prepare("INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)")
      .run(code, lead.name, lead.phone, centerId);
    const studentId = Number(r.lastInsertRowid);
    if (classId !== null) {
      db.prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)').run(
        studentId,
        classId
      );
    }
    db.prepare("UPDATE leads SET status = 'enrolled' WHERE id = ?").run(id);
    res.json({ ok: true, student_id: studentId });
  })
);

export default router;
