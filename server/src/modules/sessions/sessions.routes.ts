import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as sessionService from './sessions.service';
import { scopeFor } from '../../shared/scope';
import { actorFromReq } from '../../shared/audit';

const router = Router();

// Lấy danh sách buổi học của lớp (chỉ đọc, không sinh buổi khi GET)
router.get(
  '/classes/:classId/sessions',
  requirePermission('sessions.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(
      await sessionService.listClassSessions(
        await scopeFor(req, 'sessions.view'),
        paramId(req.params, 'classId')
      )
    );
  })
);

// Tạo buổi học thủ công
router.post(
  '/sessions',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      class_id: v.number({ required: true, integer: true, label: 'Lớp học' }),
      date: v.date({ required: true, label: 'Ngày học' }),
      topic: v.string({ max: 255, label: 'Chủ đề' }),
    });
    const created = await sessionService.createSession(await scopeFor(req, 'sessions.manage'), {
      class_id: input.class_id,
      date: input.date!,
      topic: input.topic ?? undefined,
    });
    res.status(201).json(created);
  })
);

// Cập nhật chủ đề buổi học
router.put(
  '/sessions/:id',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { topic } = validate(req.body, {
      topic: v.string({ max: 255, label: 'Chủ đề' }),
    });
    res.json(
      await sessionService.updateSessionTopic(
        await scopeFor(req, 'sessions.manage'),
        paramId(req.params),
        topic ?? undefined
      )
    );
  })
);

// Hủy buổi học (soft-cancel: status='cancelled')
router.delete(
  '/sessions/:id',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await sessionService.deleteSession(
      await scopeFor(req, 'sessions.manage'),
      paramId(req.params),
      actorFromReq(req)
    );
    res.json({ ok: true });
  })
);

// Lấy điểm danh của buổi học (kèm danh sách học viên của lớp)
router.get(
  '/sessions/:id/attendance',
  requirePermission('attendance.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(
      await sessionService.getSessionAttendance(await scopeFor(req, 'attendance.view'), paramId(req.params))
    );
  })
);

// Lưu điểm danh (upsert) — vắng mặt thì thông báo phụ huynh
router.post(
  '/sessions/:id/attendance',
  requirePermission('attendance.take', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { records } = validate(req.body, {
      records: v.any({ required: true, label: 'Dữ liệu điểm danh' }),
    });
    const result = await sessionService.saveAttendance(
      await scopeFor(req, 'attendance.take'),
      paramId(req.params),
      records as { student_id: number; status: string; note?: string }[]
    );
    res.json({ ok: true, saved: result.saved, date: result.date });
  })
);

// Sinh mã điểm danh cho buổi học (staff)
router.post(
  '/sessions/:id/checkin-code',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(
      await sessionService.generateCheckinCode(await scopeFor(req, 'sessions.manage'), paramId(req.params))
    );
  })
);

export default router;
