import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { actorFromReq } from '../../shared/audit';
import { paramId } from '../../shared/validate';
import { listGrades, createGrade, deleteGrade, type ScopeCtx } from './grades.service';

const router = Router();

/** Danh sách điểm */
router.get(
  '/',
  requirePermission('grades.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      student_id = '',
      class_id = '',
      page,
      limit,
    } = req.query as {
      student_id?: string;
      class_id?: string;
      page?: string;
      limit?: string;
    };
    const ctx: ScopeCtx = {
      centerId: reqCenterId(req),
      role: req.user?.role || '',
      teacherId: req.user?.teacher_id ?? null,
    };
    res.json(await listGrades(ctx, { student_id, class_id }, { page, limit }));
  })
);

/** Nhập điểm */
router.post(
  '/',
  requirePermission('grades.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const { student_id, class_id, title, score, max_score, comment } = req.body as Record<string, unknown>;
    if (!student_id) {
      res.status(400).json({ error: 'Vui lòng chọn học viên', code: 'BAD_REQUEST' });
      return;
    }
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Vui lòng nhập tiêu đề bài kiểm tra', code: 'BAD_REQUEST' });
      return;
    }
    const row = await createGrade({
      centerId: cid,
      student_id: Number(student_id),
      class_id: class_id ? Number(class_id) : null,
      title: String(title),
      score: Number(score),
      max_score: max_score !== undefined && max_score !== null && max_score !== '' ? Number(max_score) : 10,
      comment: (comment as string) || null,
      created_by: req.user!.id,
      role: req.user?.role || '',
      teacher_id: req.user?.teacher_id ?? null,
    });
    res.status(201).json(row);
  })
);

/** Xóa điểm */
router.delete(
  '/:id',
  requirePermission('grades.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = paramId(req.params);
    await deleteGrade(cid, id, req.user?.role || '', req.user?.teacher_id ?? null, actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
