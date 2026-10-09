import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { escapeLike } from '../../shared/like';
import { AppError } from '../../shared/errors';
import type { Db } from '../../db/pg-compat';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/* ---------------------------------- Types ---------------------------------- */

export const LEAD_STATUS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;

export interface LeadRow {
  id: number;
  center_id: number | null;
  name: string;
  phone: string;
  [key: string]: unknown;
}

export interface LeadQuery {
  status?: string;
  search?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách lead (có phân trang). */
export async function listLeads(
  centerId: number | null,
  query: LeadQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<LeadRow>> {
  const { status = '', search = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  if (status && (LEAD_STATUS as readonly string[]).includes(status)) {
    conds.push('status = ?');
    params.push(status);
  }
  if (search) {
    conds.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    const kw = `%${escapeLike(search)}%`;
    params.push(kw, kw);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM leads ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(`SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as LeadRow[];
  return paginate(rows, total, page, limit);
}

/* ------------------------- Chuyển lead thành học viên ------------------------- */

/** Sinh mã học viên duy nhất (retry khi trùng) */
async function genLeadStudentCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = `HV${Date.now().toString().slice(-6)}`;
    const exists = await tx.prepare('SELECT 1 FROM students WHERE code = ?').get(code);
    if (!exists) return code;
  }
  return `HV${Date.now().toString().slice(-8)}`;
}

export interface ConvertLeadInput {
  leadId: number;
  centerId: number | null;
  classId?: number | null;
}

/**
 * Chuyển lead thành học viên chính thức.
 * - Lead không tồn tại / khác center -> 404
 * - Đã enrolled -> 409 (atomic: UPDATE có điều kiện, chống convert đồng thời)
 * - SĐT đã là học viên -> 409
 */
export async function convertLeadToStudent(input: ConvertLeadInput): Promise<{ student_id: number }> {
  const { leadId, centerId } = input;
  const lead = (await db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)) as
    (LeadRow & { status: string }) | undefined;
  if (!lead || (centerId !== null && lead.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy lead');
  }
  if (lead.status === 'enrolled') {
    throw AppError.conflict('Lead này đã được chuyển thành học viên');
  }
  const leadCenterId = lead.center_id;
  if (leadCenterId === null) throw AppError.badRequest('Lead chưa gắn trung tâm');

  const classId: number | null = input.classId ?? null;
  if (classId !== null) {
    if (!Number.isInteger(classId)) throw AppError.badRequest('Lớp học không hợp lệ');
    const cls = (await db
      .prepare(`SELECT id FROM classes WHERE id = ?${centerId !== null ? ' AND center_id = ?' : ''}`)
      .get(...(centerId !== null ? [classId, centerId] : [classId]))) as { id: number } | undefined;
    if (!cls) throw AppError.badRequest('Lớp học không tồn tại');
  }
  if (lead.phone) {
    const dup = await db
      .prepare('SELECT id FROM students WHERE center_id = ? AND phone = ?')
      .get(leadCenterId, lead.phone);
    if (dup) throw AppError.conflict('Số điện thoại này đã là học viên của trung tâm');
  }

  return db.transaction(async (tx) => {
    // Retry khi race sinh mã trùng: catch UNIQUE violation rồi sinh mã mới
    let studentId = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await genLeadStudentCode(tx);
      try {
        const r = await tx
          .prepare(
            "INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)"
          )
          .run(code, lead.name, lead.phone, leadCenterId);
        studentId = Number(r.lastInsertRowid);
        break;
      } catch (err) {
        const msg = (err as { code?: string })?.code || '';
        if (msg === '23505' && attempt < 4) continue; // UNIQUE violation → thử mã khác
        throw err;
      }
    }
    if (studentId === 0) throw AppError.conflict('Không sinh được mã học viên, vui lòng thử lại');
    if (classId !== null) {
      await tx
        .prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)')
        .run(studentId, classId);
    }
    // Atomic: chỉ 1 luồng giành được chuyển trạng thái
    const upd = await tx
      .prepare("UPDATE leads SET status = 'enrolled' WHERE id = ? AND status != 'enrolled'")
      .run(leadId);
    if ((upd.changes ?? 0) !== 1) {
      throw AppError.conflict('Lead này đã được chuyển thành học viên');
    }
    return { student_id: studentId };
  });
}
