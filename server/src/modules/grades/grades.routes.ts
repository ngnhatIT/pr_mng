import { Router, Response } from 'express';
import { db } from '../../db';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { listGrades, type ScopeCtx } from './grades.service';

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
    res.json(listGrades(ctx, { student_id, class_id }, { page, limit }));
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
      res.status(400).json({ error: 'Vui lòng chọn học viên' });
      return;
    }
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Vui lòng nhập tiêu đề bài kiểm tra' });
      return;
    }
    const sc = Number(score);
    if (Number.isNaN(sc)) {
      res.status(400).json({ error: 'Điểm số không hợp lệ' });
      return;
    }
    const student = await db.prepare('SELECT id, center_id FROM students WHERE id = ?').get(Number(student_id)) as
      { id: number; center_id: number | null } | undefined;
    if (!student || (cid !== null && student.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy học viên' });
      return;
    }
    let classId: number | null = null;
    if (class_id) {
      const cls = await db.prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?')
        .get(Number(class_id)) as
        { id: number; center_id: number | null; teacher_id: number | null } | undefined;
      if (!cls || (cid !== null && cls.center_id !== cid)) {
        res.status(404).json({ error: 'Không tìm thấy lớp học' });
        return;
      }
      if (req.user?.role === 'teacher') {
        if (!req.user.teacher_id || cls.teacher_id !== req.user.teacher_id) {
          res.status(403).json({ error: 'Bạn chỉ được nhập điểm cho lớp của mình' });
          return;
        }
      }
      classId = cls.id;
    } else if (req.user?.role === 'teacher') {
      res.status(400).json({ error: 'Vui lòng chọn lớp học' });
      return;
    }
    const r = await db.prepare(
        'INSERT INTO grades (center_id, student_id, class_id, title, score, max_score, comment, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        cid,
        student.id,
        classId,
        String(title).trim(),
        sc,
        max_score !== undefined && max_score !== null && max_score !== '' ? Number(max_score) : 10,
        (comment as string) || null,
        req.user!.id
      );
    res.status(201).json(await db.prepare('SELECT * FROM grades WHERE id = ?').get(Number(r.lastInsertRowid)));
  })
);

/** Xóa điểm */
router.delete(
  '/:id',
  requirePermission('grades.manage'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cid = reqCenterId(req);
    const id = Number(req.params.id);
    const grade = await db.prepare(
        `SELECT g.id, s.center_id, c.teacher_id
       FROM grades g
       JOIN students s ON s.id = g.student_id
       LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.id = ?`
      )
      .get(id) as { id: number; center_id: number | null; teacher_id: number | null } | undefined;
    if (!grade || (cid !== null && grade.center_id !== cid)) {
      res.status(404).json({ error: 'Không tìm thấy điểm' });
      return;
    }
    if (req.user?.role === 'teacher' && (!req.user.teacher_id || grade.teacher_id !== req.user.teacher_id)) {
      res.status(403).json({ error: 'Bạn chỉ được xóa điểm của lớp mình' });
      return;
    }
    await db.prepare('DELETE FROM grades WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

export default router;
