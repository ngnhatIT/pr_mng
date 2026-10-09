import { Router, Response } from 'express';
import { AuthRequest, staffOnly, reqCenterId } from '../../middleware/auth';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as sessionService from './sessions.service';
import type { ScopeCtx } from './sessions.service';

const router = Router();

/** Dựng context phân quyền cho service từ request. */
function scopeOf(req: AuthRequest): ScopeCtx {
  return {
    centerId: reqCenterId(req),
    role: req.user?.role || '',
    teacherId: req.user?.teacher_id ?? null,
  };
}

// Lấy danh sách buổi học của lớp (tự sinh từ lịch nếu chưa có)
router.get(
  '/classes/:classId/sessions',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(sessionService.listClassSessions(scopeOf(req), paramId(req.params, 'classId')));
  })
);

// Tạo buổi học thủ công
router.post(
  '/sessions',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      class_id: v.number({ required: true, integer: true, label: 'Lớp học' }),
      date: v.string({ required: true, label: 'Ngày học' }),
      topic: v.string({ max: 255, label: 'Chủ đề' }),
    });
    const created = sessionService.createSession(scopeOf(req), {
      class_id: input.class_id,
      date: input.date,
      topic: input.topic ?? undefined,
    });
    res.status(201).json(created);
  })
);

// Cập nhật chủ đề buổi học
router.put(
  '/sessions/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { topic } = validate(req.body, {
      topic: v.string({ max: 255, label: 'Chủ đề' }),
    });
    res.json(sessionService.updateSessionTopic(scopeOf(req), paramId(req.params), topic ?? undefined));
  })
);

// Xóa buổi học
router.delete(
  '/sessions/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    sessionService.deleteSession(scopeOf(req), paramId(req.params));
    res.json({ ok: true });
  })
);

// Lấy điểm danh của buổi học (kèm danh sách học viên của lớp)
router.get(
  '/sessions/:id/attendance',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(sessionService.getSessionAttendance(scopeOf(req), paramId(req.params)));
  })
);

// Lưu điểm danh (upsert) — vắng mặt thì thông báo phụ huynh
router.post(
  '/sessions/:id/attendance',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { records } = validate(req.body, {
      records: v.any({ required: true, label: 'Dữ liệu điểm danh' }),
    });
    const result = sessionService.saveAttendance(
      scopeOf(req),
      paramId(req.params),
      records as { student_id: number; status: string; note?: string }[]
    );
    res.json({ ok: true, saved: result.saved, date: result.date });
  })
);

// Sinh mã điểm danh cho buổi học (staff)
router.post(
  '/sessions/:id/checkin-code',
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(sessionService.generateCheckinCode(scopeOf(req), paramId(req.params)));
  })
);

export default router;
