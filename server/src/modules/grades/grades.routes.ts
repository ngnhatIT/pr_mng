import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { actorFromReq } from '../../shared/audit';
import { paramId } from '../../shared/validate';
import { listGrades, createGrade, deleteGrade } from './grades.service';
import { scopeOf } from '../../shared/scope';

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
    res.json(await listGrades(scopeOf(req), { student_id, class_id }, { page, limit }));
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
      throw AppError.badRequest('Vui lòng chọn học viên');
    }
    if (!title || !String(title).trim()) {
      throw AppError.badRequest('Vui lòng nhập tiêu đề bài kiểm tra');
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
