import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { getDefaultCenter } from '../../utils/plans';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { audit, actorFromReq } from '../../shared/audit';
import { listRooms } from './rooms.service';

const router = Router();

/** center_id hiệu lực: superadmin (null) dùng trung tâm mặc định */
async function effCid(req: AuthRequest): Promise<number | null> {
  const cid = reqCenterId(req);
  if (cid !== null) return cid;
  return (await getDefaultCenter())?.id ?? null;
}

/** Danh sách phòng học kèm số lớp đang dùng */
router.get(
  '/',
  requirePermission('rooms.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const isSuper = req.user?.role === 'superadmin';
    const cid = isSuper ? null : await effCid(req);
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await listRooms(cid, { page, limit }));
  })
);

/** Thêm phòng học */
router.post(
  '/',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = await effCid(req);
    const { name, capacity } = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên phòng' }),
      capacity: v.number({ integer: true, min: 1, max: 10000, label: 'Sức chứa' }),
    });
    const trimmed = String(name).trim();
    // Chống trùng tên phòng trong trung tâm
    const dup = (await db
      .prepare('SELECT id FROM rooms WHERE center_id = ? AND LOWER(name) = LOWER(?)')
      .get(cid, trimmed)) as { id: number } | undefined;
    if (dup) {
      res.status(409).json({ error: 'Tên phòng đã tồn tại trong trung tâm', code: 'DUPLICATE' });
      return;
    }
    const r = await db
      .prepare('INSERT INTO rooms (center_id, name, capacity) VALUES (?, ?, ?)')
      .run(cid, trimmed, capacity ?? 30);
    const roomId = Number(r.lastInsertRowid);
    await audit({
      centerId: cid,
      action: 'create',
      entity: 'rooms',
      entityId: roomId,
      summary: `Tạo phòng "${trimmed}"`,
      actor: actorFromReq(req as AuthRequest),
    });
    res.status(201).json(await db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId));
  })
);

async function getScopedRoom(req: AuthRequest, id: number) {
  const cid = await effCid(req);
  const row = (await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)) as
    { id: number; center_id: number | null } | undefined;
  if (!row) return null;
  // superadmin (effCid = default center) vẫn được sửa phòng của mọi trung tâm? Không — chỉ phòng thuộc center hiệu lực
  if (req.user?.role !== 'superadmin' && cid !== null && row.center_id !== cid) return null;
  return row;
}

/** Sửa phòng học */
router.put(
  '/:id',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const room = await getScopedRoom(req, id);
    if (!room) {
      res.status(404).json({ error: 'Không tìm thấy phòng học', code: 'NOT_FOUND' });
      return;
    }
    const { name, capacity } = req.body as { name?: string; capacity?: number };
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Tên phòng là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const cap = Number(capacity);
    await db
      .prepare('UPDATE rooms SET name = ?, capacity = ? WHERE id = ?')
      .run(String(name).trim(), Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 30, id);
    res.json(await db.prepare('SELECT * FROM rooms WHERE id = ?').get(id));
  })
);

/** Xóa phòng học */
router.delete(
  '/:id',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const room = await getScopedRoom(req, id);
    if (!room) {
      res.status(404).json({ error: 'Không tìm thấy phòng học', code: 'NOT_FOUND' });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.prepare('UPDATE classes SET room_id = NULL WHERE room_id = ?').run(id);
      await tx.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    });
    res.json({ ok: true });
  })
);

export default router;
