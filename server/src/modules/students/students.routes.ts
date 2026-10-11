import { Router, Response } from 'express';
import { AuthRequest, reqCenterId, requireCenterId } from '../../middleware/auth';
import { ownScoped } from '../../shared/scope';
import { getPermissionScope } from '../authorization/authorization.service';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { validate, v, paramId } from '../../shared/validate';
import * as studentService from './students.service';
import { importStudents, type ImportRow } from './students.import';
import { anonymizeStudent, exportStudentData } from './students.privacy';
import { actorFromReq } from '../../shared/audit';

const router = Router();

/** Scope đọc học viên theo permission (không theo teacher_id truthy): 'own' -> chỉ lớp mình dạy. */
async function readOpts(req: AuthRequest): Promise<studentService.StudentReadOpts> {
  return {
    ownOnly: await ownScoped(req, 'students.view'),
    teacherId: req.user?.teacher_id ?? null,
    canViewInvoices: !!req.user && (await getPermissionScope(req.user.id, 'invoices.view')) !== null,
  };
}

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
  requirePermission('students.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search, status, sort, page, limit } = req.query as {
      search?: string;
      status?: string;
      sort?: string;
      page?: string;
      limit?: string;
    };
    res.json(
      await studentService.listStudents(
        reqCenterId(req),
        { search, status, sort },
        { page, limit },
        await readOpts(req)
      )
    );
  })
);

// Nhập học viên từ file (client đọc CSV -> rows). dry_run=true chỉ kiểm tra, trả lỗi theo dòng.
router.post(
  '/import',
  requirePermission('students.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { rows, dry_run } = (req.body ?? {}) as { rows?: unknown; dry_run?: unknown };
    res.json(
      await importStudents(requireCenterId(req), rows as ImportRow[], {
        dryRun: dry_run === true,
        actor: actorFromReq(req),
      })
    );
  })
);

// Quyền dữ liệu cá nhân: xuất toàn bộ dữ liệu của 1 học viên (JSON tải về)
router.get(
  '/:id/export',
  requirePermission('students.view'),
  requirePermission('reports.export'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params);
    const data = await exportStudentData(reqCenterId(req), id, actorFromReq(req));
    res.setHeader('Content-Disposition', `attachment; filename="student-${id}-data.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  })
);

// Quyền được xóa: ẩn danh (giữ hóa đơn/kết quả học, xóa thông tin định danh) — không hoàn tác
router.post(
  '/:id/anonymize',
  requirePermission('students.delete'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await anonymizeStudent(reqCenterId(req), paramId(req.params), actorFromReq(req));
    res.json({ ok: true });
  })
);

router.get(
  '/:id',
  requirePermission('students.view', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    res.json(
      await studentService.getStudentDetail(reqCenterId(req), paramId(req.params), await readOpts(req))
    );
  })
);

router.post(
  '/',
  requirePermission('students.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const input = validate(req.body, studentSchema);
    // Superadmin phải chỉ rõ center_id (400 CENTER_REQUIRED) — không tạo học viên "vô chủ" center NULL
    const created = await studentService.createStudent(requireCenterId(req), {
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
