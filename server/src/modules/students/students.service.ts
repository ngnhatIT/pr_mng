import { db } from '../../db';
import type { Tx } from '../../db';
import { AppError } from '../../shared/errors';
import { escapeLike } from '../../shared/like';
import { findByIdOr404 } from '../../shared/repository';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, type AuditActor } from '../../shared/audit';
import { deleteUploadFileByUrl } from '../../shared/upload';

/* ---------------------------------- Types ---------------------------------- */

export const STUDENT_STATUS = ['studying', 'paused', 'quit'] as const;

export interface StudentInput {
  code?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  dob?: string | null;
  address?: string | null;
  status?: string;
  note?: string | null;
}

export interface StudentRow {
  id: number;
  code: string;
  name: string;
  center_id: number | null;
  [key: string]: unknown;
}

/* --------------------------------- Service --------------------------------- */

/**
 * Tùy chọn scope cho đọc học viên:
 * - ownOnly: permission scope 'own' -> chỉ học viên đang học (enrollment active) lớp do teacherId dạy;
 *   teacherId null -> không thấy ai (fail-closed, không bao giờ fallback thấy cả trung tâm).
 * - canViewInvoices: có quyền invoices.view mới trả hóa đơn/thanh toán trong chi tiết.
 */
export interface StudentReadOpts {
  ownOnly?: boolean;
  teacherId?: number | null;
  canViewInvoices?: boolean;
}

const OWN_STUDENT_IDS = `SELECT e.student_id FROM enrollments e JOIN classes c ON c.id = e.class_id
  WHERE e.status = 'active' AND c.teacher_id = ?`;

export async function listStudents(
  centerId: number | null,
  query: { search?: string; status?: string },
  pageOpts: PageOptions = {},
  opts: StudentReadOpts = {}
): Promise<Paginated<unknown>> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  if (opts.ownOnly) {
    if (opts.teacherId) {
      conds.push(`id IN (${OWN_STUDENT_IDS})`);
      params.push(opts.teacherId);
    } else {
      conds.push('1 = 0');
    }
  }
  const { search = '', status = '' } = query;
  if (search) {
    conds.push("(name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    const kw = `%${escapeLike(search)}%`;
    params.push(kw, kw, kw);
  }
  if (status && (STUDENT_STATUS as readonly string[]).includes(status)) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM students ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(`SELECT * FROM students ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as unknown[];
  return paginate(rows, total, page, limit);
}

export async function getStudentDetail(
  centerId: number | null,
  id: number,
  opts: StudentReadOpts = {}
): Promise<Record<string, unknown>> {
  const student = await findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  // Scope 'own': chỉ xem học viên đang học lớp mình dạy (teacher_id null -> chặn)
  if (opts.ownOnly) {
    const teaches = opts.teacherId
      ? await db
          .prepare(`SELECT 1 FROM (${OWN_STUDENT_IDS}) x WHERE x.student_id = ? LIMIT 1`)
          .get(opts.teacherId, id)
      : undefined;
    if (!teaches) {
      throw AppError.forbidden('Không có quyền xem học viên này');
    }
  }
  const classes = await db
    .prepare(
      `SELECT c.id, c.name, e.status as enroll_status, e.enrolled_at
       FROM enrollments e JOIN classes c ON c.id = e.class_id
       WHERE e.student_id = ? ORDER BY e.id DESC`
    )
    .all(id);
  // Tài chính chỉ trả khi có invoices.view (giáo viên không có quyền này)
  if (!opts.canViewInvoices) return { student, classes };
  const invoices = await db
    .prepare(
      `SELECT i.*, c.name as class_name,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'confirmed'), 0) as paid
       FROM invoices i LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.student_id = ? ORDER BY i.id DESC`
    )
    .all(id);
  return { student, classes, invoices };
}

/**
 * Sinh mã học viên tự động theo trung tâm: HV + số thứ tự (max hiện có + 1, tối thiểu 4 chữ số).
 * Khóa advisory theo center tới hết transaction -> 2 request đồng thời không sinh trùng.
 * Dùng chung cho tạo học viên, chuyển học thử và chuyển lead (PHẢI gọi trong transaction, rồi INSERT ngay).
 */
export async function nextStudentCode(tx: Pick<Tx, 'prepare'>, centerId: number): Promise<string> {
  await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`student-code:${centerId}`);
  const row = (await tx
    .prepare(
      `SELECT COALESCE(MAX(substr(code, 3)::bigint), 0) as n FROM students
       WHERE center_id = ? AND code ~ '^HV[0-9]{1,9}$'`
    )
    .get(centerId)) as { n: string | number };
  return `HV${String(Number(row.n) + 1).padStart(4, '0')}`;
}

export async function createStudent(centerId: number, input: StudentInput): Promise<unknown> {
  const finalStatus =
    input.status && (STUDENT_STATUS as readonly string[]).includes(input.status) ? input.status : 'studying';
  const id = await db.transaction(async (tx) => {
    let code = input.code?.trim();
    if (code) {
      // Mã nhập tay: chỉ kiểm tra trong trung tâm (UNIQUE(center_id, code)), không lộ mã của tenant khác
      const exists = await tx
        .prepare('SELECT 1 FROM students WHERE center_id = ? AND code = ?')
        .get(centerId, code);
      if (exists) throw AppError.conflict('Mã học viên đã tồn tại');
    } else {
      code = await nextStudentCode(tx, centerId);
    }
    try {
      const r = await tx
        .prepare(
          'INSERT INTO students (code, name, phone, email, dob, address, status, note, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          code,
          input.name.trim(),
          input.phone || null,
          input.email || null,
          input.dob || null,
          input.address || null,
          finalStatus,
          input.note || null,
          centerId
        );
      return Number(r.lastInsertRowid);
    } catch (err) {
      // Race 2 request cùng nhập 1 mã tay: UNIQUE(center_id, code) chặn -> 409 thay vì 500
      if ((err as { code?: string }).code === '23505') throw AppError.conflict('Mã học viên đã tồn tại');
      throw err;
    }
  });
  return await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

export async function updateStudent(
  centerId: number | null,
  id: number,
  input: StudentInput
): Promise<unknown> {
  const st = await findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  // Chỉ đổi status khi client gửi lên — tránh "hồi sinh" học viên quit/paused về studying
  let finalStatus = st.status;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    if (!(STUDENT_STATUS as readonly string[]).includes(input.status)) {
      throw AppError.badRequest('Trạng thái học viên không hợp lệ');
    }
    finalStatus = input.status;
  }
  const r = await db
    .prepare('UPDATE students SET name=?, phone=?, email=?, dob=?, address=?, status=?, note=? WHERE id=?')
    .run(
      input.name.trim(),
      input.phone || null,
      input.email || null,
      input.dob || null,
      input.address || null,
      finalStatus,
      input.note || null,
      id
    );
  if (r.changes === 0) throw AppError.notFound('Không tìm thấy học viên');
  return await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

/** Xóa học viên + toàn bộ dữ liệu liên quan (transaction).
 * CHẶN khi còn nợ, credits dương, hoặc đã có thanh toán confirmed
 * (xóa lúc đó làm mất dữ liệu tài chính không thể đối soát).
 */
export async function deleteStudent(centerId: number | null, id: number, actor?: AuditActor): Promise<void> {
  const st = await findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  // Guard tài chính trước khi xóa
  const debtRow = (await db
    .prepare(
      `SELECT COALESCE(SUM(i.amount - COALESCE((
        SELECT SUM(p.amount) FROM payments p
        WHERE p.invoice_id = i.id AND p.status = 'confirmed'
      ), 0)), 0) as debt
      FROM invoices i WHERE i.student_id = ? AND i.status != 'cancelled'`
    )
    .get(id)) as { debt: string };
  const debt = Number(debtRow?.debt) || 0;
  if (debt > 0) {
    throw AppError.badRequest(
      `Không thể xóa: học viên còn nợ ${debt.toLocaleString('vi-VN')}đ. Thu hết nợ trước.`
    );
  }
  const creditRow = (await db
    .prepare(
      `SELECT COALESCE(SUM(c.amount - c.used_amount), 0) as c
       FROM credits c JOIN parents p ON p.id = c.parent_id
       JOIN parent_students ps ON ps.parent_id = p.id
       WHERE ps.student_id = ?`
    )
    .get(id)) as { c: string };
  if ((Number(creditRow?.c) || 0) > 0) {
    throw AppError.badRequest('Không thể xóa: học viên còn credits. Xử lý credits trước.');
  }
  const paidRow = (await db
    .prepare(
      `SELECT COUNT(*) as c FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.student_id = ? AND p.status = 'confirmed'`
    )
    .get(id)) as { c: string };
  if ((Number(paidRow?.c) || 0) > 0) {
    throw AppError.badRequest('Không thể xóa: học viên đã có thanh toán được xác nhận. Giữ lại để đối soát.');
  }
  // Giống deleteInvoice (PAY-3): còn giao dịch VNPay chờ/cần đối soát -> cascade sẽ mất dấu tiền đã trừ
  const vnp = await db
    .prepare(
      `SELECT 1 FROM payment_txns t JOIN invoices i ON i.id = t.invoice_id
       WHERE i.student_id = ? AND t.status IN ('pending', 'needs_review') LIMIT 1`
    )
    .get(id);
  if (vnp) {
    throw AppError.badRequest(
      'Không thể xóa: học viên có giao dịch VNPay đang chờ xử lý. Vui lòng thử lại sau.'
    );
  }
  // Lấy file bài nộp trước khi xóa (tránh file mồ côi)
  const submissionFiles = (await db
    .prepare('SELECT file_url FROM homework_submissions WHERE student_id = ? AND file_url IS NOT NULL')
    .all(id)) as { file_url: string }[];
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
    // PERF-4: 1 câu thay vì 1 DELETE mỗi hóa đơn
    await tx
      .prepare('DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE student_id = ?)')
      .run(id);
    await tx.prepare('DELETE FROM invoices WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM parent_students WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM leave_requests WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM grades WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM students WHERE id = ?').run(id);
  });
  // Xóa file vật lý sau khi DB đã xóa thành công
  for (const f of submissionFiles) await deleteUploadFileByUrl(f.file_url);
  await audit({
    centerId: st.center_id,
    actor,
    action: 'delete',
    entity: 'students',
    entityId: id,
    summary: `Xóa học viên ${st.code} - ${st.name} (kèm toàn bộ dữ liệu liên quan)`,
  });
}
