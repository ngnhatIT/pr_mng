import { db, recalcInvoiceStatus } from '../../db';
import { afterInvoicePaid, applyCreditToInvoice } from '../../services/referrals';
import { AppError } from '../../shared/errors';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, formatVND, type AuditActor } from '../../shared/audit';

/* ---------------------------------- Types ---------------------------------- */

export const INVOICE_STATUS = ['unpaid', 'partial', 'paid'] as const;

export interface InvoiceInput {
  student_id: number;
  class_id?: number | null;
  amount: number;
  due_date?: string | null;
  note?: string | null;
}

export interface InvoiceUpdateInput {
  amount: number;
  due_date?: string | null;
  note?: string | null;
}

export interface PaymentInput {
  amount: number;
  method?: string;
  note?: string | null;
  paid_at?: string | null;
}

export interface DebtRow {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  total: number;
  paid: number;
  invoice_dues: string | null;
  debt: number;
}

/* ------------------------------ Scope (center) ------------------------------ */

/**
 * Hóa đơn KHÔNG có center_id riêng — scope đi qua center của học viên sở hữu.
 * Không tìm thấy hoặc khác center -> ném 404 (tránh lộ sự tồn tại).
 */
function assertInvoiceScope(centerId: number | null, invoiceId: number): void {
  const row = db
    .prepare('SELECT s.center_id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?')
    .get(invoiceId) as { center_id: number | null } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy phiếu thu');
  }
}

function assertPositiveAmount(amount: unknown): number {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('Số tiền phải lớn hơn 0');
  return amt;
}

/* --------------------------------- Service --------------------------------- */

export function listInvoices(
  centerId: number | null,
  query: { status?: string; search?: string },
  pageOpts: PageOptions = {}
): Paginated<unknown> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const { status = '', search = '' } = query;
  if (status && (INVOICE_STATUS as readonly string[]).includes(status)) {
    conds.push('i.status = ?');
    params.push(status);
  }
  if (search) {
    conds.push('(s.name LIKE ? OR s.code LIKE ?)');
    const kw = `%${search}%`;
    params.push(kw, kw);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const from = `FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = i.class_id ${where}`;
  const total = (db.prepare(`SELECT COUNT(*) as c ${from}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT i.*, s.name as student_name, s.code as student_code, c.name as class_name,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'confirmed'), 0) as paid
       ${from} ORDER BY i.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as unknown[];
  return paginate(rows, total, page, limit);
}

/**
 * Công nợ: học viên còn nợ (chưa thanh toán hết).
 * Kèm invoice_dues: "id:due_date,id:due_date..." để client gửi nhắc Zalo từng hóa đơn.
 */
export function getDebtReport(centerId: number | null, pageOpts: PageOptions = {}): Paginated<DebtRow> {
  const conds = ["i.status != 'paid'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const { page, limit, offset } = parsePagination(pageOpts);
  const base = `FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${conds.join(' AND ')}`;
  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM (SELECT s.id ${base} GROUP BY s.id)`).get(...params) as {
      c: number;
    }
  ).c;
  const rows = db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone,
         SUM(i.amount) as total,
         COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed')), 0) as paid,
         GROUP_CONCAT(i.id || ':' || COALESCE(i.due_date, '')) as invoice_dues
       ${base}
       GROUP BY s.id, s.code, s.name, s.phone
       ORDER BY (SUM(i.amount) - COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed')), 0)) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Omit<DebtRow, 'debt'>[];
  const data = rows.map((r) => ({ ...r, debt: r.total - r.paid }));
  return paginate(data, total, page, limit);
}

/** Tổng quan công nợ toàn trung tâm (không phân trang) — dùng cho header/tổng. */
export function getDebtSummary(centerId: number | null): { totalDebt: number; debtorCount: number } {
  const conds = ["i.status != 'paid'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(i.amount - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed'), 0)), 0) as totalDebt,
         COUNT(DISTINCT s.id) as debtorCount
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE ${conds.join(' AND ')}`
    )
    .get(...params) as { totalDebt: number; debtorCount: number };
  return { totalDebt: row.totalDebt || 0, debtorCount: row.debtorCount || 0 };
}

export function getInvoiceDetail(centerId: number | null, id: number): Record<string, unknown> {
  assertInvoiceScope(centerId, id);
  const inv = db
    .prepare(
      `SELECT i.*, s.name as student_name, s.code as student_code, c.name as class_name
       FROM invoices i JOIN students s ON s.id = i.student_id
       LEFT JOIN classes c ON c.id = i.class_id WHERE i.id = ?`
    )
    .get(id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC').all(id);
  return { invoice: inv, payments };
}

export function createInvoice(centerId: number | null, input: InvoiceInput, actor?: AuditActor): unknown {
  if (!input.student_id) throw AppError.badRequest('Vui lòng chọn học viên');
  const amt = assertPositiveAmount(input.amount);
  const student = db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(Number(input.student_id)) as { id: number; center_id: number | null } | undefined;
  if (!student || (centerId !== null && student.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy học viên');
  }
  const r = db
    .prepare('INSERT INTO invoices (student_id, class_id, amount, due_date, note) VALUES (?, ?, ?, ?, ?)')
    .run(
      Number(input.student_id),
      input.class_id ? Number(input.class_id) : null,
      amt,
      input.due_date || null,
      input.note || null
    );
  const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(r.lastInsertRowid));
  audit({
    centerId,
    actor,
    action: 'create',
    entity: 'invoices',
    entityId: Number(r.lastInsertRowid),
    summary: `Tạo phiếu thu HD${r.lastInsertRowid}: ${formatVND(amt)}`,
    meta: { student_id: input.student_id, amount: amt },
  });
  return created;
}

export function updateInvoice(
  centerId: number | null,
  id: number,
  input: InvoiceUpdateInput,
  actor?: AuditActor
): unknown {
  assertInvoiceScope(centerId, id);
  const amt = assertPositiveAmount(input.amount);
  db.prepare('UPDATE invoices SET amount = ?, due_date = ?, note = ? WHERE id = ?').run(
    amt,
    input.due_date || null,
    input.note || null,
    id
  );
  recalcInvoiceStatus(id);
  audit({
    centerId,
    actor,
    action: 'update',
    entity: 'invoices',
    entityId: id,
    summary: `Sửa phiếu thu HD${id}: ${formatVND(amt)}`,
    meta: { amount: amt },
  });
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

export function deleteInvoice(centerId: number | null, id: number, actor?: AuditActor): void {
  assertInvoiceScope(centerId, id);
  const inv = db.prepare('SELECT amount FROM invoices WHERE id = ?').get(id) as
    { amount: number } | undefined;
  db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'invoices',
    entityId: id,
    summary: `Xóa phiếu thu HD${id}${inv ? `: ${formatVND(inv.amount)}` : ''}`,
  });
}

/** Thu tiền cho phiếu thu — chặn thu vượt số còn nợ; đủ tiền thì kích hoạt thưởng referral. */
export function recordPayment(
  centerId: number | null,
  id: number,
  input: PaymentInput,
  actor?: AuditActor
): { status: string } {
  assertInvoiceScope(centerId, id);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
    { id: number; amount: number } | undefined;
  if (!inv) throw AppError.notFound('Không tìm thấy phiếu thu');
  const amt = assertPositiveAmount(input.amount);
  const paidSoFar = (
    db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(id) as { paid: number }
  ).paid;
  if (paidSoFar + amt > inv.amount + 0.01) {
    throw AppError.badRequest(
      `Số tiền vượt quá số còn nợ (${(inv.amount - paidSoFar).toLocaleString('vi-VN')}đ)`
    );
  }
  db.prepare('INSERT INTO payments (invoice_id, amount, paid_at, method, note) VALUES (?, ?, ?, ?, ?)').run(
    id,
    amt,
    input.paid_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    input.method || 'Tiền mặt',
    input.note || null
  );
  const status = recalcInvoiceStatus(id);
  if (status === 'paid') afterInvoicePaid(id);
  audit({
    centerId,
    actor,
    action: 'payment',
    entity: 'invoices',
    entityId: id,
    summary: `Thu ${formatVND(amt)} cho HD${id} (${input.method || 'Tiền mặt'})`,
    meta: { amount: amt, method: input.method },
  });
  return { status };
}

/** Áp dụng credits của phụ huynh để trừ tiền hóa đơn. */
export function applyCredit(
  centerId: number | null,
  id: number,
  creditId: number,
  actor?: AuditActor
): { applied: number; status: string } {
  assertInvoiceScope(centerId, id);
  if (!creditId) throw AppError.badRequest('Thiếu credit_id');
  try {
    const result = applyCreditToInvoice(id, Number(creditId));
    audit({
      centerId,
      actor,
      action: 'apply_credit',
      entity: 'invoices',
      entityId: id,
      summary: `Trừ ${formatVND(result.applied)} credits cho HD${id}`,
      meta: { applied: result.applied, credit_id: creditId },
    });
    return { applied: result.applied, status: result.status };
  } catch (err) {
    throw AppError.badRequest(err instanceof Error ? err.message : 'Không thể áp dụng credits');
  }
}
