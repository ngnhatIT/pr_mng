import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import { actorFromReq } from '../../shared/audit';
import * as svc from './notifications.service';

/** Người nhận theo token: phụ huynh (bảng parents) hoặc nhân sự (bảng users) — không lẫn namespace id. */
function me(req: AuthRequest): svc.Recipient {
  const u = req.user!;
  return u.kind === 'parent' || u.role === 'parent'
    ? { type: 'parent', id: (u.parent_id ?? u.id) as number }
    : { type: 'user', id: u.id };
}

/** Chuông thông báo — dùng chung cho nhân sự và phụ huynh (mount sau requireAuth). */
export const inboxRouter = Router();

inboxRouter.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, unread } = req.query as Record<string, string | undefined>;
    res.json(await svc.listMine(me(req), { page, limit, unreadOnly: unread === '1' }));
  })
);

inboxRouter.get(
  '/unread-count',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({ unread: await svc.unreadCount(me(req)) });
  })
);

inboxRouter.post(
  '/read-all',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({ updated: await svc.markAllRead(me(req)) });
  })
);

inboxRouter.post(
  '/:id/read',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await svc.markRead(me(req), paramId(req.params));
    res.json({ ok: true });
  })
);

/** Thông báo chung gửi phụ huynh (nhân sự). */
export const announcementRouter = Router();

announcementRouter.get(
  '/',
  requirePermission('notifications.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as Record<string, string | undefined>;
    res.json(await svc.listAnnouncements(reqCenterId(req), { page, limit }));
  })
);

announcementRouter.post(
  '/',
  requirePermission('notifications.send'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      title: v.string({ required: true, max: 150, label: 'Tiêu đề' }),
      body: v.string({ required: true, max: 2000, label: 'Nội dung' }),
      class_id: v.number({ integer: true, min: 1, label: 'Lớp' }),
    });
    res
      .status(201)
      .json(
        await svc.createAnnouncement(
          requireCenterId(req),
          { title: input.title, body: input.body, class_id: input.class_id ?? null },
          actorFromReq(req)
        )
      );
  })
);
