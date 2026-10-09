import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { findByIdOr404 } from '../../shared/repository';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, type AuditActor } from '../../shared/audit';

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

export async function listStudents(
  centerId: number | null,
  query: { search?: string; status?: string },
  pageOpts: PageOptions = {}
): Promise<Paginated<unknown>> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  const { search = '', status = '' } = query;
  if (search) {
    conds.push('(name LIKE ? OR code LIKE ? OR phone LIKE ?)');
    const kw = `%${search}%`;
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
  id: number
): Promise<Record<string, unknown>> {
  const student = await findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  const classes = await db
    .prepare(
      `SELECT c.id, c.name, e.status as enroll_status, e.enrolled_at
       FROM enrollments e JOIN classes c ON c.id = e.class_id
       WHERE e.student_id = ? ORDER BY e.id DESC`
    )
    .all(id);
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

export async function createStudent(
  centerId: number | null,
  isSuperadmin: boolean,
  input: StudentInput
): Promise<unknown> {
  if (centerId === null && !isSuperadmin) throw AppError.badRequest('Thiếu thông tin trung tâm');
  const finalStatus =
    input.status && (STUDENT_STATUS as readonly string[]).includes(input.status) ? input.status : 'studying';
  const finalCode = input.code || `HV${Date.now().toString().slice(-6)}`;
  const exists = await db.prepare('SELECT 1 FROM students WHERE code = ?').get(finalCode);
  if (exists) throw AppError.conflict('Mã học viên đã tồn tại');
  const r = await db
    .prepare(
      'INSERT INTO students (code, name, phone, email, dob, address, status, note, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      finalCode,
      input.name.trim(),
      input.phone || null,
      input.email || null,
      input.dob || null,
      input.address || null,
      finalStatus,
      input.note || null,
      centerId
    );
  return await db.prepare('SELECT * FROM students WHERE id = ?').get(Number(r.lastInsertRowid));
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

/** Xóa học viên + toàn bộ dữ liệu liên quan (transaction). */
export async function deleteStudent(centerId: number | null, id: number, actor?: AuditActor): Promise<void> {
  const st = await findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
    const invs = (await tx.prepare('SELECT id FROM invoices WHERE student_id = ?').all(id)) as {
      id: number;
    }[];
    for (const inv of invs) await tx.prepare('DELETE FROM payments WHERE invoice_id = ?').run(inv.id);
    await tx.prepare('DELETE FROM invoices WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM parent_students WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM leave_requests WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM grades WHERE student_id = ?').run(id);
    await tx.prepare('DELETE FROM students WHERE id = ?').run(id);
  });
  void audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'students',
    entityId: id,
    summary: `Xóa học viên ${st.code} - ${st.name} (kèm toàn bộ dữ liệu liên quan)`,
  });
}
