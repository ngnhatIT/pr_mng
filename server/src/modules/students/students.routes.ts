import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, staffOnly } from '../../middleware/auth';
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
  dob: v.string({ label: 'Ngày sinh' }),
  address: v.string({ max: 255, label: 'Địa chỉ' }),
  status: v.string({ label: 'Trạng thái' }),
  note: v.string({ max: 500, label: 'Ghi chú' }),
};

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search, status, page, limit } = req.query as {
      search?: string;
      status?: string;
      page?: string;
      limit?: string;
    };
    res.json(studentService.listStudents(reqCenterId(req), { search, status }, { page, limit }));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(studentService.getStudentDetail(reqCenterId(req), paramId(req.params)));
  })
);

router.post(
  '/',
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, studentSchema);
    const created = studentService.createStudent(reqCenterId(req), req.user?.role === 'superadmin', {
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
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rest = validate(req.body, studentSchema);
    delete (rest as { code?: string }).code; // code không được sửa sau khi tạo
    const updated = studentService.updateStudent(reqCenterId(req), paramId(req.params), {
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
  staffOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    studentService.deleteStudent(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
