import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { validate, v, paramId } from '../../shared/validate';
import { audit, actorFromReq } from '../../shared/audit';
import { eventBus } from '../../shared/events/eventBus';
import { HomeworkCreatedEvent, HomeworkPublishedEvent } from '../../shared/events/homework.events';
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
import { scopeOf, ownScoped } from '../../shared/scope';
import { listRubrics, getRubric, createRubric, deleteRubric } from './rubric.service';
import {
  saveQuizQuestions,
  getAllAttempts,
  getQuizForStaff,
  validateQuizQuestions,
} from './quiz.service';
import type { QuizQuestionInput } from './quiz.service';
import {
  listBankQuestions,
  listBankTags,
  listBankSubjects,
  addBankQuestion,
  updateBankQuestion,
  deleteBankQuestion,
  importFromBank,
} from './questionBank.service';

const router = Router();

/** Kiểm tra các lớp thuộc scope của user (center + own-scope) */
async function getScopedClasses(req: AuthRequest, classIds: number[], permission: string) {
  const cid = reqCenterId(req);
  // Scope 'own' (giáo viên hoặc custom role): chỉ lớp của mình dạy
  const own = await ownScoped(req, permission);
  const valid: number[] = [];
  for (const id of classIds) {
    const cls = await getClassScope(id);
    if (!cls) continue;
    if (cid !== null && cls.center_id !== cid) continue;
    if (own && (!req.user?.teacher_id || cls.teacher_id !== req.user.teacher_id)) {
      continue;
    }
    valid.push(cls.id);
  }
  return valid;
}

/** Lấy bài tập thuộc scope của user, throw 404 nếu không có/không có quyền. */
async function requireHomework(req: AuthRequest, id: number, permission: string) {
  const hw = await getScopedHomework(req, id, permission);
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  return hw;
}

/** Kiểm tra bài tập thuộc scope của user */
async function getScopedHomework(req: AuthRequest, id: number, permission: string) {
  const cid = reqCenterId(req);
  const hw = await getHomeworkWithScope(id);
  if (!hw) return null;
  const hwCid = hw.center_id ?? hw.class_center_id;
  if (cid !== null && hwCid !== cid) return null;
  // Scope 'own': chỉ bài của lớp mình dạy; teacher_id null → không thấy bài nào
  if (
    (await ownScoped(req, permission)) &&
    (!req.user?.teacher_id || hw.teacher_id !== req.user.teacher_id)
  ) {
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
    const ctx = scopeOf(req);
    ctx.ownOnly = await ownScoped(req, 'homework.view');
    res.json(
      await listHomework(
        ctx,
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
    const ctx = scopeOf(req);
    ctx.ownOnly = await ownScoped(req, 'homework.view');
    res.json(await getHomeworkStats(ctx));
  })
);

/** Phân tích: hoàn thành & điểm TB theo lớp */
router.get(
  '/analytics',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const ctx = scopeOf(req);
    ctx.ownOnly = await ownScoped(req, 'homework.view');
    res.json(await getHomeworkAnalytics(ctx));
  })
);

/** Giao bài tập (1 lần cho nhiều lớp) */
router.post(
  '/',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = prepareCreateInput(req.body as Record<string, unknown>);
    // Validate câu hỏi quiz TRƯỚC khi tạo bài: câu hỏi lỗi thì 400, không tạo bài rỗng
    if (input.kind === 'quiz') {
      validateQuizQuestions(input.questions as QuizQuestionInput[]);
    }
    const validIds = await getScopedClasses(req, input.class_ids, 'homework.create');
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
    // P0-3(d): emit SAU KHI câu hỏi quiz đã lưu xong (trước đây createHomeworkBatch
    // emit trước, listener có thể thấy quiz chưa có câu hỏi)
    for (const hw of created) {
      eventBus.emitSync(new HomeworkCreatedEvent(hw.id, reqCenterId(req), input.status, input.kind));
      if (input.status === 'published') {
        eventBus.emitSync(new HomeworkPublishedEvent(hw.id, reqCenterId(req)));
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
    await requireHomework(req, id, 'homework.view');
    res.json(await getHomeworkDetail(id));
  })
);

/** Tái sử dụng bài tập (copy thành nháp mới) */
router.post(
  '/:id/reuse',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id, 'homework.create');
    const created = await reuseHomework(id, req.user!.id, reqCenterId(req));
    // P1-5: audit tái sử dụng (như các thao tác tạo khác)
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'create',
      entity: 'homework',
      entityId: created[0].id,
      summary: `Tái sử dụng bài tập "${created[0].title}" thành nháp mới`,
      meta: { title: created[0].title, source_id: id },
    });
    res.status(201).json({ created: created[0], count: 1 });
  })
);

/** Xuất bản ngay (từ nháp/hẹn giờ) */
router.post(
  '/:id/publish',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.create');
    await setHomeworkStatus(id, 'published', reqCenterId(req));
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Đăng bài tập "${hw.title}"`,
      meta: { title: hw.title },
    });
    res.json({ ok: true });
  })
);

/** Gỡ đăng (published → draft) — đăng nhầm có thể thu hồi */
router.post(
  '/:id/unpublish',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.create');
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
    await requireHomework(req, id, 'homework.grade');
    res.json(await getHomeworkScores(id));
  })
);

/** Chấm điểm 1 học viên */
router.post(
  '/:id/scores',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.grade');
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
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Chấm điểm bài "${hw.title}" — HV#${body.student_id}: ${score ?? 'chưa chấm'}`,
      meta: { title: hw.title, student_id: body.student_id, score },
    });
    res.json({ ok: true });
  })
);

/** Lịch sử làm quiz */
router.get(
  '/:id/quiz/attempts',
  requirePermission('homework.grade'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id, 'homework.grade');
    res.json(await getAllAttempts(id));
  })
);

/** Lấy đề quiz đầy đủ kèm đáp án đúng (staff — để sửa đề) */
router.get(
  '/:id/quiz/edit',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id, 'homework.create');
    res.json(await getQuizForStaff(id));
  })
);

/** Lưu bộ câu hỏi quiz */
router.put(
  '/:id/quiz',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.create');
    const { questions } = req.body as { questions: unknown };
    if (!Array.isArray(questions)) {
      throw AppError.badRequest('Thiếu danh sách câu hỏi');
    }
    await saveQuizQuestions(id, questions as never);
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Lưu đề quiz "${hw.title}" (${questions.length} câu)`,
      meta: { title: hw.title, count: questions.length },
    });
    res.json({ ok: true, count: questions.length });
  })
);

/* ------------------------------- Question Bank ------------------------------- */

router.get(
  '/bank/questions',
  requirePermission('homework.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search = '', tag = '', subject = '', difficulty = '', page, limit } = req.query as Record<
      string,
      string
    >;
    const result = await listBankQuestions(reqCenterId(req), search, tag, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    }, { subject, difficulty });
    res.json({
      ...result,
      tags: await listBankTags(reqCenterId(req)),
      subjects: await listBankSubjects(reqCenterId(req)),
    });
  })
);

router.post(
  '/bank/questions',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tag, subject, difficulty, qtype, question, points, options } = req.body as {
      tag: string;
      subject?: string | null;
      difficulty?: string | null;
      qtype?: string | null;
      question: string;
      points: number;
      options: { text: string; is_correct: boolean }[];
    };
    // Câu tự luận không có đáp án trắc nghiệm → cho phép thiếu options
    if (qtype !== 'essay' && !Array.isArray(options)) {
      throw AppError.badRequest('Thiếu đáp án');
    }
    const q = await addBankQuestion(reqCenterId(req), req.user!.id, {
      tag,
      subject,
      difficulty,
      qtype,
      question,
      points,
      options,
    });
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'create',
      entity: 'question_bank',
      entityId: q.id,
      summary: `Thêm câu hỏi vào ngân hàng (${points ?? 1} điểm)`,
      meta: { question: q.question.slice(0, 100) },
    });
    res.status(201).json(q);
  })
);

router.put(
  '/bank/questions/:bid',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const bid = paramId(req.params, 'bid');
    const { tag, subject, difficulty, qtype, question, points, options } = req.body as {
      tag: string;
      subject?: string | null;
      difficulty?: string | null;
      qtype?: string | null;
      question: string;
      points: number;
      options: { text: string; is_correct: boolean }[];
    };
    if (qtype !== 'essay' && !Array.isArray(options)) {
      throw AppError.badRequest('Thiếu đáp án');
    }
    const q = await updateBankQuestion(bid, reqCenterId(req), {
      tag,
      subject,
      difficulty,
      qtype,
      question,
      points,
      options,
    });
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'question_bank',
      entityId: bid,
      summary: `Sửa câu hỏi #${bid} trong ngân hàng`,
      meta: { question: q.question.slice(0, 100) },
    });
    res.json(q);
  })
);

router.delete(
  '/bank/questions/:bid',
  requirePermission('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const bid = paramId(req.params, 'bid');
    await deleteBankQuestion(bid, reqCenterId(req));
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'question_bank',
      entityId: bid,
      summary: `Xóa câu hỏi #${bid} khỏi ngân hàng`,
    });
    res.json({ ok: true });
  })
);

/** Import câu hỏi từ ngân hàng vào quiz */
router.post(
  '/:id/quiz/import',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.create');
    const { bank_ids } = req.body as { bank_ids: number[] };
    if (!Array.isArray(bank_ids) || !bank_ids.length) {
      throw AppError.badRequest('Chưa chọn câu hỏi');
    }
    const count = await importFromBank(id, bank_ids.map(Number), reqCenterId(req));
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Import ${count} câu từ ngân hàng vào quiz "${hw.title}"`,
      meta: { title: hw.title, count, bank_ids },
    });
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
    await requireHomework(req, id, 'homework.grade');
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
    const rubric = await createRubric(reqCenterId(req), req.user!.id, { name, criteria });
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'create',
      entity: 'rubric',
      entityId: rubric.id,
      summary: `Tạo rubric "${name}" (${criteria.length} tiêu chí)`,
      meta: { name, count: criteria.length },
    });
    res.status(201).json(rubric);
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
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'rubric',
      entityId: r.id,
      summary: `Xóa rubric "${r.name}"`,
      meta: { name: r.name },
    });
    res.json({ ok: true });
  })
);

/** Sửa bài tập */
router.put(
  '/:id',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    await requireHomework(req, id, 'homework.create');
    const body = validate(req.body, {
      // P0-2: title bắt buộc — thiếu thì 400, tránh trim() trên undefined gây 500
      title: v.string({ required: true, min: 1, max: 200, label: 'Tiêu đề' }),
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
    if (body.close_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.close_date)) {
      throw AppError.badRequest('Hạn chót không hợp lệ (YYYY-MM-DD)');
    }
    if (body.publish_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.publish_at)) {
      throw AppError.badRequest('Hẹn đăng không hợp lệ (YYYY-MM-DDTHH:mm)');
    }
    const updated = await updateHomework(
      id,
      {
        title: body.title,
        content: body.content,
        // undefined = không gửi → giữ nguyên trong DB (P0-1)
        due_date: body.due_date,
        max_score: body.max_score != null ? Number(body.max_score) : null,
        close_date: body.close_date,
        status: body.status as 'draft' | 'scheduled' | 'published' | undefined,
        publish_at: body.publish_at || null,
        rubric_id: body.rubric_id != null ? Number(body.rubric_id) : null,
      },
      reqCenterId(req) // P1-1: validate rubric_id thuộc center
    );
    // P1-5: audit sửa bài tập (như các thao tác update khác)
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'update',
      entity: 'homework',
      entityId: id,
      summary: `Sửa bài tập "${updated.title}"`,
      meta: { title: updated.title, status: updated.status },
    });
    res.json(updated);
  })
);

/** Xóa bài tập */
router.delete(
  '/:id',
  requirePermission('homework.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const hw = await requireHomework(req, id, 'homework.delete');
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
