import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { escapeLike } from '../../shared/like';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { normalizePhone } from '../../services/zalo';
import { nextStudentCode } from '../students/students.service';
import { enrollInTx } from '../classes/classes.service';

/* ---------------------------------- Types ---------------------------------- */

export const LEAD_STATUS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

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

/**
 * Danh sách lead (có phân trang) + `counts`: số lead theo TỪNG trạng thái (cùng center + search,
 * bỏ qua filter status) để kanban hiển thị đúng tổng mỗi cột thay vì đếm trên 1 trang.
 */
export async function listLeads(
  centerId: number | null,
  query: LeadQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<LeadRow> & { counts: Record<LeadStatus, number> }> {
  const { status = '', search = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('center_id = ?');
    params.push(centerId);
  }
  if (search) {
    conds.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    const kw = `%${escapeLike(search)}%`;
    params.push(kw, kw);
  }
  const baseWhere = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const countRows = (await db
    .prepare(`SELECT status, COUNT(*) as c FROM leads ${baseWhere} GROUP BY status`)
    .all(...params)) as { status: string; c: number | string }[];
  const counts = Object.fromEntries(LEAD_STATUS.map((st) => [st, 0])) as Record<LeadStatus, number>;
  for (const r of countRows) if (r.status in counts) counts[r.status as LeadStatus] = Number(r.c);

  if (status && (LEAD_STATUS as readonly string[]).includes(status)) {
    conds.push('status = ?');
    params.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM leads ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(`SELECT * FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as LeadRow[];
  return { ...paginate(rows, total, page, limit), counts };
}

/* ------------------------- Chuyển lead thành học viên ------------------------- */

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
      .prepare('SELECT id FROM classes WHERE id = ? AND center_id = ?')
      .get(classId, leadCenterId)) as { id: number } | undefined;
    if (!cls) throw AppError.badRequest('Lớp học không tồn tại');
  }
  // Lưu SĐT đã chuẩn hóa để guard trùng (so với students.phone) thật sự khớp lần sau
  const phone = lead.phone ? normalizePhone(lead.phone) || lead.phone.trim() : null;
  if (phone) {
    const dup = await db
      .prepare('SELECT id FROM students WHERE center_id = ? AND phone = ?')
      .get(leadCenterId, phone);
    if (dup) throw AppError.conflict('Số điện thoại này đã là học viên của trung tâm');
  }

  return db.transaction(async (tx) => {
    // Atomic: chỉ 1 luồng giành được chuyển trạng thái (luồng sau chờ row lock rồi thấy 0 dòng -> 409)
    const upd = await tx
      .prepare("UPDATE leads SET status = 'enrolled' WHERE id = ? AND status != 'enrolled'")
      .run(leadId);
    if ((upd.changes ?? 0) !== 1) {
      throw AppError.conflict('Lead này đã được chuyển thành học viên');
    }
    // Mã sinh dưới advisory lock theo center -> không trùng, không cần retry
    // (retry sau lỗi 23505 trong cùng transaction PG đã abort là vô ích)
    const code = await nextStudentCode(tx, leadCenterId);
    const r = await tx
      .prepare("INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)")
      .run(code, lead.name, phone, leadCenterId);
    const studentId = Number(r.lastInsertRowid);
    // Ghi danh qua logic có lock + kiểm tra sĩ số như ghi danh thủ công
    if (classId !== null) await enrollInTx(tx, classId, studentId);
    return { student_id: studentId };
  });
}

/* ------------------------------ CRUD (staff) ------------------------------ */

/** Lấy lead và kiểm tra thuộc trung tâm của user (404 nếu không). */
async function getScopedLead(id: number, centerId: number | null) {
  const row = (await db.prepare('SELECT * FROM leads WHERE id = ?').get(id)) as
    (LeadRow & { source: string | null; status: string; note: string | null }) | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId))
    throw AppError.notFound('Không tìm thấy lead');
  return row;
}

/** Tạo lead (staff). Body đã qua validate() ở route. */
export async function createLead(centerId: number, body: Record<string, unknown> | undefined) {
  const name = String(body?.name ?? '').trim();
  const rawPhone = String(body?.phone ?? '').trim();
  const phone = normalizePhone(rawPhone) || rawPhone; // lưu dạng chuẩn để so trùng với học viên
  if (!name) throw AppError.badRequest('Tên khách hàng là bắt buộc', 'VALIDATION_REQUIRED');
  if (!phone) throw AppError.badRequest('Số điện thoại là bắt buộc', 'VALIDATION_REQUIRED');
  // 'enrolled' chỉ đạt được qua POST /:id/convert (tạo học viên)
  const status =
    body?.status &&
    body.status !== 'enrolled' &&
    (LEAD_STATUS as readonly string[]).includes(String(body.status))
      ? String(body.status)
      : 'new';
  const source = body?.source ? String(body.source).trim() : null;
  const note = body?.note ? String(body.note).trim() : null;
  const r = await db
    .prepare('INSERT INTO leads (center_id, name, phone, source, status, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(centerId, name, phone, source, status, note);
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
}

/** Cập nhật một phần lead (staff); khóa trạng thái của lead đã chuyển thành học viên. */
export async function updateLead(
  centerId: number | null,
  id: number,
  body: Record<string, unknown> | undefined
) {
  const lead = await getScopedLead(id, centerId);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw AppError.badRequest('Tên khách hàng không được để trống');
    sets.push('name = ?');
    params.push(name);
  }
  if (body?.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (!phone) throw AppError.badRequest('Số điện thoại không được để trống');
    sets.push('phone = ?');
    params.push(normalizePhone(phone) || phone);
  }
  if (body?.source !== undefined) {
    sets.push('source = ?');
    params.push(body.source ? String(body.source).trim() : null);
  }
  if (body?.status !== undefined) {
    const status = String(body.status);
    if (!(LEAD_STATUS as readonly string[]).includes(status)) {
      throw AppError.badRequest('Trạng thái không hợp lệ', 'VALIDATION_INVALID');
    }
    // Lead đã chuyển thành học viên: khóa trạng thái (mở lại rồi convert lần nữa = học viên trùng)
    if (lead.status === 'enrolled' && status !== 'enrolled') {
      throw AppError.conflict('Lead đã chuyển thành học viên, không thể đổi trạng thái');
    }
    // Chặn set 'enrolled' trực tiếp (phải dùng POST /:id/convert để tạo học viên)
    if (status === 'enrolled' && lead.status !== 'enrolled') {
      throw AppError.badRequest(
        "Không thể chuyển trạng thái thành 'enrolled' trực tiếp, hãy dùng chức năng chuyển đổi",
        'VALIDATION_INVALID'
      );
    }
    sets.push('status = ?');
    params.push(status);
  }
  if (body?.note !== undefined) {
    sets.push('note = ?');
    params.push(body.note ? String(body.note).trim() : null);
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

export async function deleteLead(centerId: number | null, id: number, actor: AuditActor): Promise<void> {
  const lead = await getScopedLead(id, centerId);
  await db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  await audit({
    centerId: lead.center_id,
    actor,
    action: 'delete',
    entity: 'leads',
    entityId: id,
    summary: `Xóa lead ${lead.name} (${lead.phone})`,
    meta: { status: lead.status, source: lead.source },
  });
}
