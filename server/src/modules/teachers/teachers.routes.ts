import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import {
  listTeachers,
  getTeacherDetail,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  createTeacherAccount,
} from './teachers.service';
import { actorFromReq } from '../../shared/audit';

const router = Router();

router.get(
  '/',
  requirePermission('teachers.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit } = req.query as { page?: string; limit?: string };
    res.json(await listTeachers(reqCenterId(req), { page, limit }));
  })
);

router.get(
  '/:id',
  requirePermission('teachers.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(await getTeacherDetail(reqCenterId(req), paramId(req.params)));
  })
);

router.post(
  '/',
  requirePermission('teachers.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // SEC-5: superadmin phải chỉ rõ center_id — không tạo giáo viên center_id NULL (tài khoản thành "toàn hệ thống")
    const cid = requireCenterId(req);
    const data = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên giáo viên' }),
      phone: v.string({ max: 20, label: 'Số điện thoại' }),
      email: v.string({ max: 100, label: 'Email' }),
      subject: v.string({ max: 100, label: 'Môn dạy' }),
    });
    res.status(201).json(await createTeacher(cid, data));
  })
);

router.put(
  '/:id',
  requirePermission('teachers.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = validate(req.body, {
      name: v.string({ required: true, max: 100, label: 'Tên giáo viên' }),
      phone: v.string({ max: 20, label: 'Số điện thoại' }),
      email: v.string({ max: 100, label: 'Email' }),
      subject: v.string({ max: 100, label: 'Môn dạy' }),
    });
    res.json(await updateTeacher(reqCenterId(req), paramId(req.params), data));
  })
);

router.delete(
  '/:id',
  requirePermission('teachers.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deleteTeacher(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

/** Tạo tài khoản đăng nhập cho giáo viên (admin): POST /api/teachers/:id/account {username, password} */
router.post(
  '/:id/account',
  requirePermission('users.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      res.status(400).json({ error: 'Tên đăng nhập và mật khẩu là bắt buộc', code: 'VALIDATION_REQUIRED' });
      return;
    }
    const out = await createTeacherAccount(
      reqCenterId(req),
      paramId(req.params),
      username.trim(),
      password,
      actorFromReq(req)
    );
    res.status(201).json(out);
  })
);

export default router;
