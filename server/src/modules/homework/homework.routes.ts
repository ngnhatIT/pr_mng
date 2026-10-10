import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { validate, v, paramId } from '../../shared/validate';
import { audit, actorFromReq } from '../../shared/audit';
import {
  listHomework,
  getHomeworkStats,
  getHomeworkAnalytics,
  createHomeworkBatch,
  prepareCreateInput,
  getHomeworkDetail,
  updateHomework,
  deleteHomework,
  reuseHomework,
  gradeHomework,
  getHomeworkScores,
  setHomeworkStatus,
  getClassScope,
  getHomeworkWithScope,
  filterValidTargets,
  getHomeworkSubmissions,
} from './homework.service';
import { scopeOf } from '../../shared/scope';
import { listRubrics, getRubric, createRubric, deleteRubric } from './rubric.service';
import { saveQuizQuestions, getAllAttempts, getQuizForStaff } from './quiz.service';
import {
  listBankQuestions,
  listBankTags,
  addBankQuestion,
  deleteBankQuestion,
  importFromBank,
} from './questionBank.service';

const router = Router();

/** Kiểm tra các lớp thuộc scope của user (center + teacher) */
async function getScopedClasses(req: AuthRequest, classIds: number[]) {
  const cid = reqCenterId(req);
  const valid: number[] = [];
  for (const id of classIds) {
    const cls = await getClassScope(id);
    if (!cls) continue;
    if (cid !== null && cls.center_id !== cid) continue;
    if (req.user?.role === 'teacher' && (!req.user.teacher_id || cls.teacher_id !== req.user.teacher_id)) {
      continue;
    }
    valid.push(cls.id);
  }
  return valid;
}

/** Lấy bài tập thuộc scope của user, throw 404 nếu không có/không có quyền. */
async function requireHomework(req: AuthRequest, id: number) {
  const hw = await getScopedHomework(req, id);
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  return hw;
}

/** Kiểm tra bài tập thuộc scope của user */
async function getScopedHomework(req: AuthRequest, id: number) {
  const cid = reqCenterId(req);
  const hw = await getHomeworkWithScope(id);
  if (!hw) return null;
  const hwCid = hw.center_id ?? hw.class_center_id;
  if (cid !== null && hwCid !== cid) return null;
  if (req.user?.role === 'teacher' && (!req.user.teacher_id || hw.teacher_id !== req.user.teacher_id)) {
    return null;
  }
  return hw;
}

/** Danh sách bài tập (filter: lớp, tìm kiếm, hạn, trạng thái, loại) */
router.get(
  '/',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      class_id = '',
      search = '',
      due = '',
      status = '',
      kind = '',
      page,
      limit,
    } = req.query as Record<string, string>;
    // Mặc định ẩn nháp? Không — staff thấy tất cả, phân biệt bằng status badge
    res.json(
      await listHomework(
        scopeOf(req),
        {
          class_id,
          search,
          due: due as '' | 'upcoming' | 'overdue' | 'nodate',
          status: status as '' | 'draft' | 'scheduled' | 'published',
          kind: kind as '' | 'homework' | 'quiz',
        },
        { page, limit }
      )
    );
  })
);

/** Thống kê nhanh */
router.get(
  '/stats',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await getHomeworkStats(scopeOf(req)));
  })
);

/** Phân tích: hoàn thành & điểm TB theo lớp */
router.get(
  '/analytics',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await getHomeworkAnalytics(scopeOf(req)));
  })
);

/** Giao bài tập (1 lần cho nhiều lớp) */
router.post(
  '/',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = prepareCreateInput(req.body as Record<string, unknown>);
    const validIds = await getScopedClasses(req, input.class_ids);
    if (!validIds.length) throw AppError.notFound('Không tìm thấy lớp học hợp lệ');
    // Lọc target students thuộc các lớp được chọn
    const targetIds = await filterValidTargets(validIds, input.target_student_ids);
    const created = await createHomeworkBatch({
      class_ids: validIds,
      title: input.title,
      content: input.content,
      due_date: input.due_date,
      created_by: req.user!.id,
      centerId: reqCenterId(req),
      status: input.status,
      publish_at: input.publish_at,
      max_score: input.max_score,
      close_date: input.close_date,
      kind: input.kind,
      rubric_id: input.rubric_id,
      attachments: input.attachments,
      target_student_ids: targetIds,
    });
    // Lưu câu hỏi quiz
    if (input.kind === 'quiz' && input.questions.length) {
      for (const hw of created) {
        await saveQuizQuestions(hw.id, input.questions as never);
      }
    }
    const statusLabel =
      input.status === 'draft' ? 'nháp' : input.status === 'scheduled' ? 'hẹn giờ đăng' : 'đăng';
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'create',
      entity: 'homework',
      entityId: created[0].id,
      summary: `Tạo bài tập "${input.title}" (${statusLabel}) cho ${validIds.length} lớp`,
      meta: { title: input.title, class_ids: validIds, status: input.status, kind: input.kind },
    });
    // Zalo notification: tự động qua HomeworkPublishedEvent → ZaloListener
    res.status(201).json({ created, count: created.length });
  })
);

/** Chi tiết bài tập (kèm đính kèm) */
router.get(
  '/:id',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    res.json(await getHomeworkDetail(id));
  })
);

/** Tái sử dụng bài tập (copy thành nháp mới) */
router.post(
  '/:id/reuse',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const created = await reuseHomework(id, req.user!.id, reqCenterId(req));
    res.status(201).json({ created: created[0], count: 1 });
  })
);

/** Xuất bản ngay (từ nháp/hẹn giờ) */
router.post(
  '/:id/publish',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    await setHomeworkStatus(id, 'published', reqCenterId(req));
    res.json({ ok: true });
  })
);

/** Gỡ đăng (published → draft) — đăng nhầm có thể thu hồi */
router.post(
  '/:id/unpublish',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id);
    await setHomeworkStatus(id, 'draft', reqCenterId(req));
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Gỡ đăng bài tập "${hw.title}" về nháp`,
      meta: { title: hw.title },
    });
    res.json({ ok: true });
  })
);

/** Bảng điểm của bài tập */
router.get(
  '/:id/scores',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    res.json(await getHomeworkScores(id));
  })
);

/** Chấm điểm 1 học viên */
router.post(
  '/:id/scores',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const body = validate(req.body, {
      student_id: v.number({ integer: true, min: 1, label: 'Học viên' }),
      score: v.any({ label: 'Điểm' }),
      feedback: v.string({ max: 2000, label: 'Nhận xét' }),
    });
    const score =
      body.score === null || body.score === undefined || body.score === '' ? null : Number(body.score);
    if (score !== null && (!Number.isFinite(score) || score < 0)) {
      throw AppError.badRequest('Điểm không hợp lệ');
    }
    await gradeHomework(
      id,
      body.student_id as number,
      score,
      (body.feedback as string) || null,
      req.user!.id
    );
    res.json({ ok: true });
  })
);

/** Lịch sử làm quiz */
router.get(
  '/:id/quiz/attempts',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    res.json(await getAllAttempts(id));
  })
);

/** Lấy đề quiz đầy đủ kèm đáp án đúng (staff — để sửa đề) */
router.get(
  '/:id/quiz/edit',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    res.json(await getQuizForStaff(id));
  })
);

/** Lưu bộ câu hỏi quiz */
router.put(
  '/:id/quiz',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const { questions } = req.body as { questions: unknown };
    if (!Array.isArray(questions)) {
      throw AppError.badRequest('Thiếu danh sách câu hỏi');
    }
    await saveQuizQuestions(id, questions as never);
    res.json({ ok: true, count: questions.length });
  })
);

/* ------------------------------- Question Bank ------------------------------- */

router.get(
  '/bank/questions',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search = '', tag = '', page, limit } = req.query as Record<string, string>;
    const result = await listBankQuestions(reqCenterId(req), search, tag, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ ...result, tags: await listBankTags(reqCenterId(req)) });
  })
);

router.post(
  '/bank/questions',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tag, question, points, options } = req.body as {
      tag: string;
      question: string;
      points: number;
      options: { text: string; is_correct: boolean }[];
    };
    if (!Array.isArray(options)) {
      throw AppError.badRequest('Thiếu đáp án');
    }
    res
      .status(201)
      .json(await addBankQuestion(reqCenterId(req), req.user!.id, { tag, question, points, options }));
  })
);

router.delete(
  '/bank/questions/:bid',
  requirePermission('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteBankQuestion(paramId(req.params, 'bid'), reqCenterId(req));
    res.json({ ok: true });
  })
);

/** Import câu hỏi từ ngân hàng vào quiz */
router.post(
  '/:id/quiz/import',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const { bank_ids } = req.body as { bank_ids: number[] };
    if (!Array.isArray(bank_ids) || !bank_ids.length) {
      throw AppError.badRequest('Chưa chọn câu hỏi');
    }
    const count = await importFromBank(id, bank_ids.map(Number), reqCenterId(req));
    res.status(201).json({ ok: true, count });
  })
);

/* ------------------------------- Submissions ------------------------------- */

/** Staff xem bài nộp của 1 bài tập */
router.get(
  '/:id/submissions',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const { page, limit } = req.query as Record<string, string>;
    res.json(
      await getHomeworkSubmissions(id, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      })
    );
  })
);

/* --------------------------------- Rubrics --------------------------------- */

router.get(
  '/rubrics/list',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await listRubrics(reqCenterId(req)));
  })
);

router.post(
  '/rubrics/list',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { name, criteria } = req.body as { name: string; criteria: { name: string; max_score: number }[] };
    if (!Array.isArray(criteria)) {
      throw AppError.badRequest('Thiếu danh sách tiêu chí');
    }
    res.status(201).json(await createRubric(reqCenterId(req), req.user!.id, { name, criteria }));
  })
);

router.delete(
  '/rubrics/:rid',
  requirePermission('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const r = await getRubric(paramId(req.params, 'rid'), reqCenterId(req));
    if (!r) {
      throw AppError.notFound('Không tìm thấy rubric');
    }
    await deleteRubric(r.id, reqCenterId(req));
    res.json({ ok: true });
  })
);

/** Sửa bài tập */
router.put(
  '/:id',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id);
    const body = validate(req.body, {
      title: v.string({ min: 1, max: 200, label: 'Tiêu đề' }),
      content: v.string({ max: 5000, label: 'Nội dung' }),
      due_date: v.string({ label: 'Hạn nộp' }),
      max_score: v.number({ label: 'Điểm tối đa' }),
      close_date: v.string({ label: 'Hạn chót' }),
      status: v.string({ label: 'Trạng thái' }),
      publish_at: v.string({ label: 'Hẹn đăng' }),
      rubric_id: v.number({ label: 'Rubric' }),
    });
    if (body.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
      throw AppError.badRequest('Hạn nộp không hợp lệ (YYYY-MM-DD)');
    }
    res.json(
      await updateHomework(id, {
        title: body.title as string,
        content: body.content,
        due_date: body.due_date || null,
        max_score: body.max_score != null ? Number(body.max_score) : null,
        close_date: body.close_date || null,
        status: body.status as 'draft' | 'scheduled' | 'published' | undefined,
        publish_at: body.publish_at || null,
        rubric_id: body.rubric_id != null ? Number(body.rubric_id) : null,
      })
    );
  })
);

/** Xóa bài tập */
router.delete(
  '/:id',
  requirePermission('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id);
    await deleteHomework(id, reqCenterId(req));
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'homework',
      entityId: id,
      summary: `Xóa bài tập "${hw.title}"`,
      meta: { title: hw.title },
    });
    res.json({ ok: true });
  })
);

export default router;
