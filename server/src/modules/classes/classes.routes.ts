import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as classService from './classes.service';
import { scopeOf } from '../../shared/scope';
import { actorFromReq } from '../../shared/audit';

const router = Router();

router.get(
  '/',
  requirePermission('classes.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = req.query as { page?: string; limit?: string; search?: string };
    res.json(await classService.listClasses(scopeOf(req), { search }, { page, limit }));
  })
);

router.get(
  '/:id',
  requirePermission('classes.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await classService.getClassDetail(scopeOf(req), paramId(req.params)));
  })
);

router.post(
  '/',
  requirePermission('classes.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      name: v.string({ required: true, max: 150, label: 'Tên lớp học' }),
      teacher_id: v.number({ integer: true, label: 'Giáo viên' }),
      schedule: v.any({ label: 'Lịch học' }),
      start_date: v.date({ label: 'Ngày bắt đầu' }),
      end_date: v.date({ label: 'Ngày kết thúc' }),
      tuition_fee: v.number({ min: 0, label: 'Học phí' }),
      max_students: v.number({ integer: true, min: 1, label: 'Sĩ số tối đa' }),
      status: v.string({ label: 'Trạng thái' }),
      room_id: v.number({ integer: true, label: 'Phòng học' }),
    });
    const created = await classService.createClass(scopeOf(req), input);
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  requirePermission('classes.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, {
      name: v.string({ required: true, max: 150, label: 'Tên lớp học' }),
      teacher_id: v.number({ integer: true, label: 'Giáo viên' }),
      schedule: v.any({ label: 'Lịch học' }),
      start_date: v.date({ label: 'Ngày bắt đầu' }),
      end_date: v.date({ label: 'Ngày kết thúc' }),
      tuition_fee: v.number({ min: 0, label: 'Học phí' }),
      max_students: v.number({ integer: true, min: 1, label: 'Sĩ số tối đa' }),
      status: v.string({ label: 'Trạng thái' }),
      room_id: v.number({ integer: true, label: 'Phòng học' }),
    });
    res.json(await classService.updateClass(scopeOf(req), paramId(req.params), input));
  })
);

router.delete(
  '/:id',
  requirePermission('classes.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await classService.deleteClass(scopeOf(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

router.post(
  '/:id/enroll',
  requirePermission('classes.enroll'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { student_id } = validate(req.body, {
      student_id: v.number({ required: true, integer: true, label: 'Học viên' }),
    });
    await classService.enrollStudent(scopeOf(req), paramId(req.params), student_id as number);
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/enrollments/:enrollmentId',
  requirePermission('classes.enroll'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await classService.unenroll(scopeOf(req), paramId(req.params, 'enrollmentId'));
    res.json({ ok: true });
  })
);

export default router;
