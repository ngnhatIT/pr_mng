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

// Lịch buổi học theo khoảng ngày (trang Lịch): ?from=&to=&teacher_id=&room_id=&class_id=
router.get(
  '/sessions',
  requirePermission('sessions.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const q = validate(req.query, {
      from: v.date({ required: true, label: 'Từ ngày' }),
      to: v.date({ required: true, label: 'Đến ngày' }),
      teacher_id: v.number({ integer: true, min: 1, label: 'Giáo viên' }),
      room_id: v.number({ integer: true, min: 1, label: 'Phòng' }),
      class_id: v.number({ integer: true, min: 1, label: 'Lớp' }),
    });
    res.json(
      await sessionService.listCalendar(await scopeFor(req, 'sessions.view'), {
        from: q.from!,
        to: q.to!,
        teacherId: q.teacher_id ?? undefined,
        roomId: q.room_id ?? undefined,
        classId: q.class_id ?? undefined,
      })
    );
  })
);

// Sửa buổi học: chủ đề, dạy thay, phòng, giờ riêng (chỉ trường gửi lên mới đổi; null = về mặc định của lớp)
router.put(
  '/sessions/:id',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      topic: v.string({ max: 255, label: 'Chủ đề' }),
      teacher_id: v.number({ integer: true, min: 1, label: 'Giáo viên' }),
      room_id: v.number({ integer: true, min: 1, label: 'Phòng' }),
      start_time: v.string({ max: 5, label: 'Giờ bắt đầu' }),
      end_time: v.string({ max: 5, label: 'Giờ kết thúc' }),
    });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: sessionService.SessionPatch = {};
    for (const k of ['topic', 'teacher_id', 'room_id', 'start_time', 'end_time'] as const) {
      if (k in body) (patch as Record<string, unknown>)[k] = input[k] ?? null;
    }
    res.json(
      await sessionService.updateSessionDetails(
        await scopeFor(req, 'sessions.manage'),
        paramId(req.params),
        patch,
        actorFromReq(req)
      )
    );
  })
);

// Dời buổi sang ngày khác (hủy mềm buổi gốc + tạo buổi mới trỏ về buổi gốc)
router.post(
  '/sessions/:id/reschedule',
  requirePermission('sessions.manage', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      date: v.date({ required: true, label: 'Ngày mới' }),
      start_time: v.string({ max: 5, label: 'Giờ bắt đầu' }),
      end_time: v.string({ max: 5, label: 'Giờ kết thúc' }),
      teacher_id: v.number({ integer: true, min: 1, label: 'Giáo viên' }),
      room_id: v.number({ integer: true, min: 1, label: 'Phòng' }),
    });
    res.status(201).json(
      await sessionService.rescheduleSession(
        await scopeFor(req, 'sessions.manage'),
        paramId(req.params),
        {
          date: input.date!,
          start_time: input.start_time || null,
          end_time: input.end_time || null,
          teacher_id: input.teacher_id ?? null,
          room_id: input.room_id ?? null,
        },
        actorFromReq(req)
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
