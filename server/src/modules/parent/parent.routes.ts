import { Router, Response } from 'express';
import { AuthRequest, parentAuth } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { uploadSingle, assertSafeUpload, cleanupUploadedFile } from '../../shared/upload';
import { validate, v, paramId } from '../../shared/validate';
import { env } from '../../config/env';
import { audit } from '../../shared/audit';
import * as parentService from './parent.service';
import { assertStrongPassword } from '../../shared/password';
import { rotateRefreshToken, revokeRefreshToken, revokeAllForOwner, revokeAllForOwnerExcept } from '../auth/refresh.service';
import {
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
  requireSameOrigin,
} from '../../middleware/cookieAuth';

/** Path cookie refresh cho phụ huynh: tách khỏi staff để 2 phiên không đè nhau. */
const COOKIE_PATH = '/api/v1/parent';

const router = Router();

/** Context phụ huynh từ token. */
function ctx(req: AuthRequest): { parentId: number; centerId: number | null } {
  return { parentId: req.user!.parent_id as number, centerId: req.user!.center_id ?? null };
}

/** Lấy student_id từ query/body, throw 400 nếu thiếu hoặc không phải số nguyên dương. */
function reqStudentId(req: AuthRequest): number {
  const id = Number(req.query.student_id ?? req.body.student_id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('Thiếu student_id');
  return id;
}

/* ------------------------------- Auth (public) ------------------------------- */

router.post(
  '/register',
  loginRateLimit,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      phone: v.string({ required: true, label: 'Số điện thoại' }),
      password: v.string({ required: true, min: 8, label: 'Mật khẩu' }),
      name: v.string({ required: true, max: 100, label: 'Họ tên' }),
      center_id: v.number({ required: true, label: 'Trung tâm' }),
    });
    // Chặn mật khẩu phổ biến (validate() chỉ check độ dài)
    assertStrongPassword(input.password);
    const result = await parentService.registerParent(input);
    // D4: refresh token chỉ đi qua HttpOnly cookie, KHÔNG trả trong body nữa
    setRefreshCookie(res, result.refresh_token, COOKIE_PATH);
    res.status(201).json({ token: result.token, expires_in: result.expires_in, parent: result.parent });
  })
);

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      phone: v.string({ required: true, label: 'Số điện thoại' }),
      password: v.string({ required: true, label: 'Mật khẩu' }),
      center_id: v.number({ required: false, label: 'Trung tâm' }),
    });
    const result = await parentService.loginParent(input);
    // D4: refresh token chỉ đi qua HttpOnly cookie, KHÔNG trả trong body nữa
    setRefreshCookie(res, result.refresh_token, COOKIE_PATH);
    res.json({ token: result.token, expires_in: result.expires_in, parent: result.parent });
  })
);

/** Đổi refresh token (đọc từ HttpOnly cookie) lấy cặp token mới (rotation). */
router.post(
  '/refresh',
  loginRateLimit,
  requireSameOrigin, // D4: cookie tự gửi theo request -> cần chống CSRF
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const refreshToken = getRefreshCookie(req);
    if (!refreshToken) {
      res.status(400).json({ error: 'Thiếu refresh token', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const pair = await rotateRefreshToken(refreshToken, { ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
    setRefreshCookie(res, pair.refresh_token, COOKIE_PATH);
    res.json({ token: pair.token, expires_in: pair.expires_in });
  })
);

/** Đăng xuất phụ huynh: thu hồi refresh token trong cookie rồi xóa cookie. */
router.post(
  '/logout',
  requireSameOrigin, // D4: chống CSRF
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const refreshToken = getRefreshCookie(req);
    if (refreshToken) await revokeRefreshToken(refreshToken);
    clearRefreshCookie(res, COOKIE_PATH);
    res.json({ ok: true });
  })
);

/* --------------------- Từ đây yêu cầu đăng nhập phụ huynh --------------------- */
router.use(parentAuth);

/** H5: lấy trạng thái đồng ý nhận tin Zalo ZNS. */
router.get(
  '/consent',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json({ zalo_consent: await parentService.getZaloConsent(ctx(req).parentId) });
  })
);

/** H5: phụ huynh tự bật/tắt nhận tin Zalo ZNS. */
router.put(
  '/consent',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { consent } = (req.body ?? {}) as { consent?: string };
    res.json({ ok: true, zalo_consent: await parentService.setZaloConsent(ctx(req).parentId, consent ?? '') });
  })
);

/** Đổi mật khẩu phụ huynh: yêu cầu mật khẩu cũ + thu hồi mọi session khác. */
router.post(
  '/change-password',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const { old_password, new_password } = validate(req.body, {
      old_password: v.string({ required: true, label: 'Mật khẩu cũ' }),
      new_password: v.string({ required: true, min: 8, max: 72, label: 'Mật khẩu mới' }),
    });
    if (old_password === new_password) {
      res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu cũ', code: 'SAME_PASSWORD' });
      return;
    }
    assertStrongPassword(new_password);
    await parentService.changePassword(parentId, old_password, new_password);
    // Thu hồi mọi session khác (giữ session hiện tại)
    // D4: đọc refresh token từ cookie (fallback body cho client cũ trong đợt rolling deploy)
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    await revokeAllForOwnerExcept('parent', parentId, getRefreshCookie(req) ?? refresh_token);
    await audit({
      centerId: null,
      action: 'change_password',
      entity: 'parents',
      entityId: parentId,
      summary: `Phụ huynh #${parentId} đổi mật khẩu`,
    });
    res.json({ ok: true });
  })
);

/** Đăng xuất mọi thiết bị của phụ huynh. */
router.post(
  '/logout-all',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    await revokeAllForOwner('parent', parentId);
    res.json({ ok: true });
  })
);

router.post(
  '/link',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId, centerId } = ctx(req);
    const { student_code, dob } = validate(req.body, {
      student_code: v.string({ required: true, label: 'Mã học viên' }),
      dob: v.string({ required: true, label: 'Ngày sinh' }),
    });
    const student = await parentService.linkStudent(parentId, centerId, student_code, dob);
    res.status(201).json({ ok: true, student });
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
    const baseUrl = env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res
      .status(201)
      .json(await parentService.createVnpayPayment(parentId, paramId(req.params), baseUrl, req.ip || ''));
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
    await parentService.markHomeworkComplete(parentId, student_id as number, homeworkId);
    res.status(201).json({ ok: true });
  })
);

/** Bỏ đánh dấu hoàn thành bài tập */
router.delete(
  '/homework/:homeworkId/complete',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = reqStudentId(req);
    await parentService.unmarkHomeworkComplete(parentId, studentId, homeworkId);
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
    if (
      !Array.isArray(answers) ||
      answers.some(
        (a) =>
          typeof a !== 'object' ||
          a === null ||
          !Number.isInteger((a as { question_id?: unknown }).question_id) ||
          !Number.isInteger((a as { option_id?: unknown }).option_id)
      )
    ) {
      // Validate shape ở trust boundary: phần tử sai shape (null, thiếu id)
      // sẽ làm submitQuiz 500 khi đọc a.question_id
      throw AppError.badRequest('Bài làm không hợp lệ');
    }
    res
      .status(201)
      .json(
        await parentService.submitChildQuiz(parentId, student_id as number, homeworkId, answers as never)
      );
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
    // E2: fileFilter của multer chỉ check đuôi file (chạy trước khi ghi đĩa) —
    // kiểm tra magic bytes + mimetype tại đây, file giả mạo → xóa + 400.
    if (req.file) assertSafeUpload(req.file);
    const { parentId } = ctx(req);
    const homeworkId = paramId(req.params, 'homeworkId');
    const studentId = Number(req.body.student_id);
    if (!studentId) {
      cleanupUploadedFile(req.file);
      throw AppError.badRequest('Thiếu student_id');
    }
    const note = String(req.body.note || '').slice(0, 1000);
    try {
      await parentService.submitHomework(parentId, studentId, homeworkId, {
        file_url: req.file ? `/uploads/${req.file.filename}` : null,
        file_name: req.file ? req.file.originalname : null,
        note: note || null,
      });
    } catch (err) {
      cleanupUploadedFile(req.file);
      throw err;
    }
    res.status(201).json({ ok: true });
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
