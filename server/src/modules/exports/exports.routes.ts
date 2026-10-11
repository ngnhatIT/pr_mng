import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { collectAll, sendCsv, toCsv, type CsvColumn } from '../../shared/csv';
import { todayVN } from '../../shared/vnTime';
import * as studentService from '../students/students.service';
import * as invoiceService from '../invoices/invoices.service';
import { calcPayrollBulk, currentMonth, assertValidMonth } from '../payroll/payroll.service';

/**
 * Xuất CSV (mở được bằng Excel/Google Sheets). Cần quyền xem dữ liệu + 'reports.export'.
 * ?lang=en -> tiêu đề cột tiếng Anh; filter giống API danh sách tương ứng.
 */
const router = Router();
type Row = Record<string, unknown>;
type Lang = 'vi' | 'en';
const langOf = (req: AuthRequest): Lang => (req.query.lang === 'en' ? 'en' : 'vi');
const col = (vi: string, en: string, value: (r: Row) => unknown) => ({ vi, en, value });
const cols = (lang: Lang, defs: ReturnType<typeof col>[]): CsvColumn<Row>[] =>
  defs.map((d) => ({ header: d[lang], value: d.value }));
const STATUS: Record<string, Record<Lang, string>> = {
  studying: { vi: 'Đang học', en: 'Studying' },
  paused: { vi: 'Tạm nghỉ', en: 'Paused' },
  quit: { vi: 'Đã nghỉ', en: 'Quit' },
  unpaid: { vi: 'Chưa thanh toán', en: 'Unpaid' },
  partial: { vi: 'Thanh toán một phần', en: 'Partially paid' },
  paid: { vi: 'Đã thanh toán', en: 'Paid' },
};
const statusLabel = (lang: Lang, s: unknown) => STATUS[String(s)]?.[lang] ?? s;
const q = (req: AuthRequest, k: string) =>
  typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined;

router.get(
  '/students.csv',
  requirePermission('students.view'),
  requirePermission('reports.export'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const filter = { search: q(req, 'search'), status: q(req, 'status') };
    const rows = (await collectAll((page) =>
      studentService.listStudents(reqCenterId(req), filter, { page, limit: 100 })
    )) as Row[];
    const lang = langOf(req);
    const columns = cols(lang, [
      col('Mã HV', 'Code', (r) => r.code),
      col('Họ tên', 'Name', (r) => r.name),
      col('Điện thoại', 'Phone', (r) => r.phone),
      col('Email', 'Email', (r) => r.email),
      col('Ngày sinh', 'Date of birth', (r) => r.dob),
      col('Trạng thái', 'Status', (r) => statusLabel(lang, r.status)),
      col('Lớp đang học', 'Active classes', (r) => r.class_names),
      col('Ngày tạo', 'Created at', (r) => r.created_at),
    ]);
    sendCsv(res, `students-${todayVN()}.csv`, toCsv(columns, rows));
  })
);

router.get(
  '/invoices.csv',
  requirePermission('invoices.view'),
  requirePermission('reports.export'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const filter = { search: q(req, 'search'), status: q(req, 'status') };
    const rows = (await collectAll((page) =>
      invoiceService.listInvoices(reqCenterId(req), filter, { page, limit: 100 })
    )) as Row[];
    const lang = langOf(req);
    const columns = cols(lang, [
      col('Số HĐ', 'Invoice #', (r) => r.id),
      col('Mã HV', 'Student code', (r) => r.student_code),
      col('Học viên', 'Student', (r) => r.student_name),
      col('Lớp', 'Class', (r) => r.class_name),
      col('Số tiền', 'Amount', (r) => r.amount),
      col('Đã thu', 'Paid', (r) => r.paid),
      col('Còn nợ', 'Balance', (r) => Number(r.amount) - Number(r.paid)),
      col('Hạn', 'Due date', (r) => r.due_date),
      col('Trạng thái', 'Status', (r) => statusLabel(lang, r.status)),
      col('Ghi chú', 'Note', (r) => r.note),
      col('Ngày tạo', 'Created at', (r) => r.created_at),
    ]);
    sendCsv(res, `invoices-${todayVN()}.csv`, toCsv(columns, rows));
  })
);

router.get(
  '/debt.csv',
  requirePermission('invoices.view'),
  requirePermission('reports.export'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rows = (await collectAll((page) =>
      invoiceService.getDebtReport(reqCenterId(req), { page, limit: 100 })
    )) as unknown as Row[];
    const lang = langOf(req);
    const columns = cols(lang, [
      col('Mã HV', 'Student code', (r) => r.code),
      col('Học viên', 'Student', (r) => r.name),
      col('Điện thoại', 'Phone', (r) => r.phone),
      col('Tổng HĐ', 'Invoiced', (r) => r.total),
      col('Đã thu', 'Paid', (r) => r.paid),
      col('Còn nợ', 'Balance', (r) => r.debt),
    ]);
    sendCsv(res, `debt-${todayVN()}.csv`, toCsv(columns, rows));
  })
);

router.get(
  '/payroll.csv',
  requirePermission('payroll.view'),
  requirePermission('reports.export'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const m = q(req, 'month');
    const month = m ? (assertValidMonth(m), m) : currentMonth();
    const rows = (await calcPayrollBulk(reqCenterId(req), month)) as unknown as Row[];
    const lang = langOf(req);
    const columns = cols(lang, [
      col('Tháng', 'Month', () => month),
      col('Giáo viên', 'Teacher', (r) => r.teacher_name),
      col('Số buổi', 'Sessions', (r) => r.sessions),
      col('Đơn giá tháng', 'Rate', (r) => r.month_rate),
      col('Tổng lương', 'Total', (r) => r.total),
    ]);
    sendCsv(res, `payroll-${month}.csv`, toCsv(columns, rows));
  })
);

export default router;
