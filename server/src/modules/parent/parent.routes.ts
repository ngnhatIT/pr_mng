import { Router, Response } from 'express';
import { AuthRequest, parentAuth } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { uploadSingle, cleanupUploadedFile } from '../../shared/upload';
import { validate, v, paramId } from '../../shared/validate';
import * as parentService from './parent.service';

const router = Router();

/** Context phụ huynh từ token. */
function ctx(req: AuthRequest): { parentId: number; centerId: number | null } {
  return { parentId: req.user!.parent_id as number, centerId: req.user!.center_id ?? null };
}

/** Lấy student_id từ query/body, throw 400 nếu thiếu. */
function reqStudentId(req: AuthRequest): number {
  const id = Number(req.query.student_id ?? req.body.student_id);
  if (!id) throw AppError.badRequest('Thiếu student_id');
  return id;
}

/* ------------------------------- Auth (public) ------------------------------- */

router.post(
  '/register',
  loginRateLimit,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      phone: v.string({ required: true, label: 'Số điện thoại' }),
      password: v.string({ required: true, min: 4, label: 'Mật khẩu' }),
      name: v.string({ required: true, max: 100, label: 'Họ tên' }),
    });
    const result = await parentService.registerParent(input);
    res.status(201).json(result);
  })
);

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      phone: v.string({ required: true, label: 'Số điện thoại' }),
      password: v.string({ required: true, label: 'Mật khẩu' }),
    });
    res.json(await parentService.loginParent(input));
  })
);

/* --------------------- Từ đây yêu cầu đăng nhập phụ huynh --------------------- */
router.use(parentAuth);

router.post(
  '/link',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId, centerId } = ctx(req);
    const { student_code } = validate(req.body, {
      student_code: v.string({ required: true, label: 'Mã học viên' }),
    });
    const student = await parentService.linkStudent(parentId, centerId, student_code);
    res.json({ ok: true, student });
  })
);

router.get(
  '/children',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.listChildren(ctx(req).parentId));
  })
);

router.get(
  '/children/:id/overview',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.getChildOverview(ctx(req).parentId, paramId(req.params)));
  })
);

router.get(
  '/children/:id/grades',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.listChildGrades(ctx(req).parentId, paramId(req.params)));
  })
);

router.get(
  '/invoices/:id/vietqr',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.getVietqrInfo(ctx(req).parentId, paramId(req.params)));
  })
);

router.post(
  '/invoices/:id/claim-paid',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await parentService.claimPaid(ctx(req).parentId, paramId(req.params));
    res.status(201).json({ ok: true, ...result });
  })
);

router.post(
  '/invoices/:id/vnpay',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(await parentService.createVnpayPayment(parentId, paramId(req.params), baseUrl, req.ip || ''));
  })
);

router.post(
  '/leaves',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      student_id: v.number({ integer: true, label: 'Học viên' }),
      class_id: v.number({ integer: true, label: 'Lớp học' }),
      from_date: v.string({ label: 'Ngày bắt đầu' }),
      to_date: v.string({ label: 'Ngày kết thúc' }),
      reason: v.string({ max: 500, label: 'Lý do' }),
    });
    const result = await parentService.createLeave(ctx(req).parentId, input);
    res.status(201).json(result);
  })
);

router.get(
  '/leaves',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.listLeaves(ctx(req).parentId));
  })
);

router.get(
  '/referral',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json(await parentService.getReferralInfo(ctx(req).parentId, origin));
  })
);

router.post(
  '/reviews',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId, centerId } = ctx(req);
    const input = validate(req.body, {
      rating: v.number({ integer: true, min: 1, max: 5, label: 'Đánh giá' }),
      comment: v.string({ max: 1000, label: 'Nhận xét' }),
    });
    const result = await parentService.createReview(parentId, centerId, input);
    res.status(201).json(result);
  })
);

router.get(
  '/reviews',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await parentService.listMyReviews(ctx(req).parentId));
  })
);

/** Đánh dấu con đã làm xong bài tập */
router.post(
  '/homework/:homeworkId/complete',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const { student_id } = validate(req.body, {
      student_id: v.number({ integer: true, min: 1, label: 'Học viên' }),
    });
    parentService.markHomeworkComplete(parentId, student_id as number, homeworkId);
    res.json({ ok: true });
  })
);

/** Bỏ đánh dấu hoàn thành bài tập */
router.delete(
  '/homework/:homeworkId/complete',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = reqStudentId(req);
    parentService.unmarkHomeworkComplete(parentId, studentId, homeworkId);
    res.json({ ok: true });
  })
);

/** Lấy đề quiz cho con làm bài (ẩn đáp án đúng) */
router.get(
  '/homework/:homeworkId/quiz',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = reqStudentId(req);
    res.json(await parentService.getQuizForChild(parentId, studentId, homeworkId));
  })
);

/** Nộp bài quiz → tự chấm điểm */
router.post(
  '/homework/:homeworkId/quiz/submit',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const { student_id, answers } = validate(req.body, {
      student_id: v.number({ integer: true, min: 1, label: 'Học viên' }),
      answers: v.any({ label: 'Bài làm' }),
    });
    if (!Array.isArray(answers)) {
      res.status(400).json({ error: 'Bài làm không hợp lệ' });
      return;
    }
    res.json(await parentService.submitChildQuiz(parentId, student_id as number, homeworkId, answers as never));
  })
);

/** Lịch sử làm quiz của con */
router.get(
  '/homework/:homeworkId/quiz/attempts',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = reqStudentId(req);
    res.json(await parentService.getChildQuizAttempts(parentId, studentId, homeworkId));
  })
);

/** Xem lại chi tiết 1 lượt làm (đáp án đúng/sai) */
router.get(
  '/quiz/attempts/:attemptId/review',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const attemptId = paramId(req.params, 'attemptId');
    const studentId = reqStudentId(req);
    res.json(await parentService.getChildAttemptReview(parentId, studentId, attemptId));
  })
);

/* ------------------------------- Nộp bài ------------------------------- */



/** Phụ huynh/học viên nộp bài (ảnh/file + ghi chú) */
router.post(
  '/homework/:homeworkId/submit',
  uploadSingle,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = Number(req.body.student_id);
    if (!studentId) {
      cleanupUploadedFile(req.file);
      throw AppError.badRequest('Thiếu student_id');
    }
    const note = String(req.body.note || '').slice(0, 1000);
    try {
      parentService.submitHomework(parentId, studentId, homeworkId, {
        file_url: req.file ? `/uploads/${req.file.filename}` : null,
        file_name: req.file ? req.file.originalname : null,
        note: note || null,
      });
    } catch (err) {
      cleanupUploadedFile(req.file);
      throw err;
    }
    res.json({ ok: true });
  })
);

/** Xem bài đã nộp của con */
router.get(
  '/homework/:homeworkId/submissions',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = reqStudentId(req);
    res.json(await parentService.getChildSubmissions(parentId, studentId, homeworkId));
  })
);

export default router;
