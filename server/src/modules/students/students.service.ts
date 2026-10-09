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

export function listStudents(
  centerId: number | null,
  query: { search?: string; status?: string },
  pageOpts: PageOptions = {}
): Paginated<unknown> {
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
  const total = (db.prepare(`SELECT COUNT(*) as c FROM students ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM students ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown[];
  return paginate(rows, total, page, limit);
}

export function getStudentDetail(centerId: number | null, id: number): Record<string, unknown> {
  const student = findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  const classes = db
    .prepare(
      `SELECT c.id, c.name, e.status as enroll_status, e.enrolled_at
       FROM enrollments e JOIN classes c ON c.id = e.class_id
       WHERE e.student_id = ? ORDER BY e.id DESC`
    )
    .all(id);
  const invoices = db
    .prepare(
      `SELECT i.*, c.name as class_name,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'confirmed'), 0) as paid
       FROM invoices i LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.student_id = ? ORDER BY i.id DESC`
    )
    .all(id);
  return { student, classes, invoices };
}

export function createStudent(centerId: number | null, isSuperadmin: boolean, input: StudentInput): unknown {
  if (centerId === null && !isSuperadmin) throw AppError.badRequest('Thiếu thông tin trung tâm');
  const finalStatus =
    input.status && (STUDENT_STATUS as readonly string[]).includes(input.status) ? input.status : 'studying';
  const finalCode = input.code || `HV${Date.now().toString().slice(-6)}`;
  const exists = db.prepare('SELECT 1 FROM students WHERE code = ?').get(finalCode);
  if (exists) throw AppError.conflict('Mã học viên đã tồn tại');
  const r = db
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
  return db.prepare('SELECT * FROM students WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function updateStudent(centerId: number | null, id: number, input: StudentInput): unknown {
  findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  const finalStatus =
    input.status && (STUDENT_STATUS as readonly string[]).includes(input.status) ? input.status : 'studying';
  const r = db
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
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

/** Xóa học viên + toàn bộ dữ liệu liên quan (transaction). */
export function deleteStudent(centerId: number | null, id: number, actor?: AuditActor): void {
  const st = findByIdOr404<StudentRow>('students', id, centerId, 'Không tìm thấy học viên');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM attendance WHERE student_id = ?').run(id);
    db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
    const invs = db.prepare('SELECT id FROM invoices WHERE student_id = ?').all(id) as { id: number }[];
    for (const inv of invs) db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(inv.id);
    db.prepare('DELETE FROM invoices WHERE student_id = ?').run(id);
    db.prepare('DELETE FROM parent_students WHERE student_id = ?').run(id);
    db.prepare('DELETE FROM leave_requests WHERE student_id = ?').run(id);
    db.prepare('DELETE FROM grades WHERE student_id = ?').run(id);
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
  });
  tx();
  audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'students',
    entityId: id,
    summary: `Xóa học viên ${st.code} - ${st.name} (kèm toàn bộ dữ liệu liên quan)`,
  });
}
