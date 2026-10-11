import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { actorFromReq } from '../../shared/audit';
import { listRooms, createRoom, updateRoom, deleteRoom } from './rooms.service';

const router = Router();

/** Danh sách phòng học kèm số lớp đang dùng */
router.get(
  '/',
  requirePermission('rooms.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req); // superadmin: null = mọi trung tâm
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await listRooms(cid, { page, limit }));
  })
);

/** Thêm phòng học */
router.post(
  '/',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Superadmin phải chỉ rõ center_id (400 CENTER_REQUIRED), không ngầm ghi vào tenant #1
    const cid = requireCenterId(req);
    const { name, capacity } = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên phòng' }),
      capacity: v.number({ integer: true, min: 1, max: 10000, label: 'Sức chứa' }),
    });
    res.status(201).json(await createRoom(cid, String(name).trim(), capacity ?? 30, actorFromReq(req)));
  })
);

/** Sửa phòng học */
router.put(
  '/:id',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const { name, capacity } = req.body as { name?: string; capacity?: number };
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Tên phòng là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const trimmed = String(name).trim();
    if (trimmed.length > 100) {
      res.status(400).json({ error: 'Tên phòng tối đa 100 ký tự', code: 'VALIDATION_INVALID' });
      return;
    }
    const cap = Number(capacity);
    if (!Number.isFinite(cap) || cap < 1 || cap > 10000) {
      res.status(400).json({ error: 'Sức chứa phải từ 1 đến 10000', code: 'VALIDATION_INVALID' });
      return;
    }
    res.json(await updateRoom(reqCenterId(req), id, trimmed, Math.floor(cap), actorFromReq(req)));
  })
);

/** Xóa phòng học */
router.delete(
  '/:id',
  requirePermission('rooms.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteRoom(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
