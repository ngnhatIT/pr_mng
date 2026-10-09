import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as studentService from './students.service';
import { actorFromReq } from '../../shared/audit';

const router = Router();

const studentSchema = {
  code: v.string({ max: 20, label: 'Mã học viên' }),
  name: v.string({ required: true, max: 100, label: 'Tên học viên' }),
  phone: v.string({ max: 20, label: 'Số điện thoại' }),
  email: v.string({ max: 100, label: 'Email' }),
  dob: v.date({ label: 'Ngày sinh' }),
  address: v.string({ max: 255, label: 'Địa chỉ' }),
  status: v.string({ label: 'Trạng thái' }),
  note: v.string({ max: 500, label: 'Ghi chú' }),
};

router.get(
  '/',
  requirePermission('students.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search, status, page, limit } = req.query as {
      search?: string;
      status?: string;
      page?: string;
      limit?: string;
    };
    res.json(
      await studentService.listStudents(
        reqCenterId(req),
        { search, status },
        { page, limit },
        {
          teacherId: req.user?.teacher_id ?? null,
        }
      )
    );
  })
);

router.get(
  '/:id',
  requirePermission('students.view'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(
      await studentService.getStudentDetail(reqCenterId(req), paramId(req.params), {
        teacherId: (req as AuthRequest).user?.teacher_id ?? null,
      })
    );
  })
);

router.post(
  '/',
  requirePermission('students.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, studentSchema);
    const created = await studentService.createStudent(reqCenterId(req), req.user?.role === 'superadmin', {
      code: input.code ?? undefined,
      name: input.name,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      dob: input.dob ?? undefined,
      address: input.address ?? undefined,
      status: input.status ?? undefined,
      note: input.note ?? undefined,
    });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  requirePermission('students.update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rest = validate(req.body, studentSchema);
    delete (rest as { code?: string }).code; // code không được sửa sau khi tạo
    const updated = await studentService.updateStudent(reqCenterId(req), paramId(req.params), {
      name: rest.name,
      phone: rest.phone ?? undefined,
      email: rest.email ?? undefined,
      dob: rest.dob ?? undefined,
      address: rest.address ?? undefined,
      status: rest.status ?? undefined,
      note: rest.note ?? undefined,
    });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  requirePermission('students.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await studentService.deleteStudent(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
