import { db } from '../../db';
import { afterInvoicePaid, applyCreditToInvoice } from '../referrals/rewards.service';
import { AppError } from '../../shared/errors';
import { escapeLike } from '../../shared/like';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { audit, formatVND, type AuditActor } from '../../shared/audit';
import { nowVNSql } from '../../shared/vnTime';
import { logger } from '../../shared/logger';
import { formatError } from '../../shared/errorFormat';

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

/**
 * S-1: hình thức nhân viên được ghi tay. 'credit' | 'refund' | 'vnpay' | 'bank_transfer' là giá trị
 * hệ thống (áp credits, hoàn tiền, cổng online, phụ huynh báo CK) — ghi tay sẽ làm sai luồng hoàn tiền.
 */
export const STAFF_PAYMENT_METHODS = ['Tiền mặt', 'Chuyển khoản', 'Quẹt thẻ', 'Ví điện tử', 'Khác'] as const;

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
async function assertInvoiceScope(centerId: number | null, invoiceId: number): Promise<void> {
  const row = (await db
    .prepare('SELECT s.center_id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?')
    .get(invoiceId)) as { center_id: number | null } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy phiếu thu');
  }
}

function assertPositiveAmount(amount: unknown): number {
  // VND không có xu lẻ — làm tròn TRƯỚC khi kiểm tra dương (INV-3: 0.4 -> 0 phải bị chặn)
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('Số tiền phải lớn hơn 0');
  return amt;
}

/* --------------------------------- Service --------------------------------- */

// Tổng đã thu (status='confirmed') của từng hóa đơn i — PERF-2: LATERAL chỉ chạy cho các hóa đơn
// còn lại sau WHERE (dùng idx_payments_invoice_status), không gom cả bảng payments mọi trung tâm.
// Dùng chung cho mọi query công nợ (cả dashboard).
export const confirmedPaidJoin = `LEFT JOIN LATERAL (SELECT SUM(amount) as paid FROM payments
  WHERE invoice_id = i.id AND status = 'confirmed') pp ON true`;

export async function listInvoices(
  centerId: number | null,
  query: { status?: string; search?: string },
  pageOpts: PageOptions = {}
): Promise<Paginated<unknown>> {
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
    conds.push("(s.name LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\')");
    const kw = `%${escapeLike(search)}%`;
    params.push(kw, kw);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const from = `FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = i.class_id ${where}`;
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from}`).get(...params)) as { c: number }).c;
  const rows = (await db
    .prepare(
      `SELECT i.*, s.name as student_name, s.code as student_code, c.name as class_name,
         COALESCE(pp.paid, 0) as paid
       FROM (SELECT i.id ${from} ORDER BY i.id DESC LIMIT ? OFFSET ?) page
       JOIN invoices i ON i.id = page.id JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = i.class_id
       ${confirmedPaidJoin}
       ORDER BY i.id DESC`
    )
    .all(...params, limit, offset)) as unknown[];
  return paginate(rows, total, page, limit);
}

/**
 * Công nợ: học viên còn nợ (chưa thanh toán hết).
 * Kèm invoice_dues: "id:due_date,id:due_date..." để client gửi nhắc Zalo từng hóa đơn.
 */
export async function getDebtReport(
  centerId: number | null,
  pageOpts: PageOptions = {}
): Promise<Paginated<DebtRow>> {
  const conds = ["i.status != 'paid'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const { page, limit, offset } = parsePagination(pageOpts);
  const base = `FROM invoices i JOIN students s ON s.id = i.student_id ${confirmedPaidJoin} WHERE ${conds.join(' AND ')}`;
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM (SELECT s.id ${base} GROUP BY s.id)`).get(...params)) as {
      c: number;
    }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone,
         SUM(i.amount) as total,
         COALESCE(SUM(pp.paid), 0) as paid,
         STRING_AGG(i.id || ':' || COALESCE(i.due_date, ''), ',' ORDER BY i.id) as invoice_dues
       ${base}
       GROUP BY s.id, s.code, s.name, s.phone
       ORDER BY (SUM(i.amount) - COALESCE(SUM(pp.paid), 0)) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as Omit<DebtRow, 'debt'>[];
  const data = rows.map((r) => ({ ...r, debt: r.total - r.paid }));
  return paginate(data, total, page, limit);
}

/** Tổng quan công nợ toàn trung tâm (không phân trang) — dùng cho header/tổng. */
export async function getDebtSummary(
  centerId: number | null
): Promise<{ totalDebt: number; debtorCount: number }> {
  const conds = ["i.status != 'paid'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const row = (await db
    .prepare(
      `SELECT
         COALESCE(SUM(i.amount - COALESCE(pp.paid, 0)), 0) as "totalDebt",
         COUNT(DISTINCT s.id) as "debtorCount"
       FROM invoices i JOIN students s ON s.id = i.student_id
       ${confirmedPaidJoin}
       WHERE ${conds.join(' AND ')}`
    )
    .get(...params)) as { totalDebt: number; debtorCount: number };
  return { totalDebt: Number(row.totalDebt) || 0, debtorCount: Number(row.debtorCount) || 0 };
}

export async function getInvoiceDetail(
  centerId: number | null,
  id: number
): Promise<Record<string, unknown>> {
  await assertInvoiceScope(centerId, id);
  const inv = await db
    .prepare(
      `SELECT i.*, s.name as student_name, s.code as student_code, c.name as class_name,
         COALESCE(pp.paid, 0) as paid
       FROM invoices i JOIN students s ON s.id = i.student_id
       LEFT JOIN classes c ON c.id = i.class_id
       ${confirmedPaidJoin}
       WHERE i.id = ?`
    )
    .get(id);
  const payments = await db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC')
    .all(id);
  return { invoice: inv, payments };
}

export async function createInvoice(
  centerId: number | null,
  input: InvoiceInput,
  actor?: AuditActor
): Promise<unknown> {
  if (!input.student_id) throw AppError.badRequest('Vui lòng chọn học viên');
  const amt = assertPositiveAmount(input.amount);
  const student = (await db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(Number(input.student_id))) as { id: number; center_id: number | null } | undefined;
  if (!student || (centerId !== null && student.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy học viên');
  }
  // INV-2: lớp phải cùng trung tâm với học viên (chống lộ tên lớp tenant khác qua JOIN)
  if (input.class_id) {
    const cls = (await db
      .prepare('SELECT center_id FROM classes WHERE id = ?')
      .get(Number(input.class_id))) as { center_id: number | null } | undefined;
    if (!cls || cls.center_id !== student.center_id) throw AppError.notFound('Không tìm thấy lớp học');
  }
  const r = await db
    .prepare(
      'INSERT INTO invoices (student_id, class_id, amount, due_date, note, center_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      Number(input.student_id),
      input.class_id ? Number(input.class_id) : null,
      amt,
      input.due_date || null,
      input.note || null,
      student.center_id
    );
  const created = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(r.lastInsertRowid));
  await audit({
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

export async function updateInvoice(
  centerId: number | null,
  id: number,
  input: InvoiceUpdateInput,
  actor?: AuditActor
): Promise<unknown> {
  await assertInvoiceScope(centerId, id);
  const amt = assertPositiveAmount(input.amount);
  // INV-1: check + update trong 1 transaction, lock hóa đơn (cùng lock với recordPayment/IPN/approve)
  const current = await db.transaction(async (tx) => {
    const cur = (await tx.prepare('SELECT amount, status FROM invoices WHERE id = ? FOR UPDATE').get(id)) as
      { amount: number; status: string } | undefined;
    if (!cur) throw AppError.notFound('Không tìm thấy phiếu thu');
    const paid = Number(
      (
        (await tx
          .prepare(
            "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
          )
          .get(id)) as { paid: number }
      ).paid
    );
    const confirmed = (
      (await tx
        .prepare("SELECT COUNT(*) as c FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
        .get(id)) as { c: number }
    ).c;
    // Chặn sửa số tiền khi đã có thanh toán được xác nhận (tránh xóa nợ / tạo nợ ảo)
    if (Math.round(cur.amount) !== amt && Number(confirmed) > 0) {
      throw AppError.badRequest('Không thể sửa số tiền của phiếu thu đã có thanh toán được xác nhận');
    }
    const status = paid >= amt - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    await tx
      .prepare('UPDATE invoices SET amount = ?, due_date = ?, note = ?, status = ? WHERE id = ?')
      .run(amt, input.due_date || null, input.note || null, status, id);
    return cur;
  });
  await audit({
    centerId,
    actor,
    action: 'update',
    entity: 'invoices',
    entityId: id,
    summary: `Sửa phiếu thu HD${id}: ${formatVND(amt)}`,
    meta: { amount: amt, old_amount: current?.amount ?? null },
  });
  return await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

export async function deleteInvoice(centerId: number | null, id: number, actor?: AuditActor): Promise<void> {
  await assertInvoiceScope(centerId, id);
  let deletedAmount: number | null = null;
  await db.transaction(async (tx) => {
    // Lock invoice trước để chống double-delete đồng thời
    const locked = (await tx.prepare('SELECT id, amount FROM invoices WHERE id = ? FOR UPDATE').get(id)) as
      { id: number; amount: number } | undefined;
    if (!locked) throw AppError.notFound('Không tìm thấy phiếu thu');
    deletedAmount = locked.amount;
    // Chặn xóa hóa đơn đã có thanh toán được xác nhận — check TRONG transaction,
    // sau khi lock, để không bị TOCTOU với luồng confirm payment đồng thời
    const confirmed = (
      (await tx
        .prepare("SELECT COUNT(*) as c FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
        .get(id)) as {
        c: number;
      }
    ).c;
    if (confirmed > 0) {
      throw AppError.badRequest('Không thể xóa phiếu thu đã có thanh toán được xác nhận');
    }
    // PAY-3: còn giao dịch VNPay đang chờ/cần xử lý -> chặn xóa (cascade sẽ làm mất dấu tiền VNPay đã trừ)
    const vnp = await tx
      .prepare(
        "SELECT 1 FROM payment_txns WHERE invoice_id = ? AND status IN ('pending', 'needs_review') LIMIT 1"
      )
      .get(id);
    if (vnp) {
      throw AppError.badRequest(
        'Phiếu thu đang có giao dịch VNPay chờ xử lý, chưa thể xóa. Vui lòng thử lại sau.'
      );
    }
    await tx.prepare('DELETE FROM payments WHERE invoice_id = ?').run(id);
    await tx.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  });
  await audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'invoices',
    entityId: id,
    summary: `Xóa phiếu thu HD${id}${deletedAmount !== null ? `: ${formatVND(deletedAmount)}` : ''}`,
  });
}

/** Thu tiền cho phiếu thu — chặn thu vượt số còn nợ; đủ tiền thì kích hoạt thưởng referral.
 * Toàn bộ check + ghi nhận bọc trong transaction với SELECT ... FOR UPDATE
 * trên hóa đơn (chống 2 request đồng thời cùng thu vượt). */
export async function recordPayment(
  centerId: number | null,
  id: number,
  input: PaymentInput,
  actor?: AuditActor
): Promise<{ status: string }> {
  await assertInvoiceScope(centerId, id);
  const amt = assertPositiveAmount(input.amount);
  const method = input.method || 'Tiền mặt';
  if (!(STAFF_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw AppError.badRequest('Hình thức thu không hợp lệ', 'VALIDATION_ENUM');
  }
  const status = await db.transaction(async (tx) => {
    const inv = (await tx.prepare('SELECT id, amount FROM invoices WHERE id = ? FOR UPDATE').get(id)) as
      { id: number; amount: number } | undefined;
    if (!inv) throw AppError.notFound('Không tìm thấy phiếu thu');
    const paidSoFar = Number(
      (
        (await tx
          .prepare(
            "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
          )
          .get(id)) as { paid: number }
      ).paid
    );
    if (paidSoFar + amt > inv.amount + 0.01) {
      throw AppError.badRequest(
        `Số tiền vượt quá số còn nợ (${(inv.amount - paidSoFar).toLocaleString('vi-VN')}đ)`
      );
    }
    await tx
      .prepare('INSERT INTO payments (invoice_id, amount, paid_at, method, note) VALUES (?, ?, ?, ?, ?)')
      .run(id, amt, input.paid_at || nowVNSql(), method, input.note || null);
    // Recalc tx-scoped: thấy INSERT vừa rồi, không cần connection riêng
    const newStatus = paidSoFar + amt >= inv.amount - 0.01 ? 'paid' : 'partial';
    await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, id);
    return newStatus;
  });
  if (status === 'paid') await afterInvoicePaid(id);
  await audit({
    centerId,
    actor,
    action: 'payment',
    entity: 'invoices',
    entityId: id,
    summary: `Thu ${formatVND(amt)} cho HD${id} (${method})`,
    meta: { amount: amt, method },
  });
  return { status };
}

/** O-2: credits còn dùng được cho hóa đơn (của phụ huynh đã liên kết học viên, cùng trung tâm, chưa thu hồi). */
export async function listInvoiceCredits(
  centerId: number | null,
  id: number
): Promise<{ id: number; available: number; reason: string | null; parent_name: string }[]> {
  await assertInvoiceScope(centerId, id);
  const rows = (await db
    .prepare(
      `SELECT c.id, c.amount - c.used_amount AS available, c.reason, p.name AS parent_name
       FROM invoices i
       JOIN students s ON s.id = i.student_id
       JOIN parent_students ps ON ps.student_id = i.student_id
       JOIN credits c ON c.parent_id = ps.parent_id
       JOIN parents p ON p.id = c.parent_id
       WHERE i.id = ? AND c.center_id = s.center_id AND c.voided_at IS NULL AND c.amount > c.used_amount
       ORDER BY c.id`
    )
    .all(id)) as { id: number; available: number; reason: string | null; parent_name: string }[];
  return rows.map((r) => ({ ...r, available: Number(r.available) }));
}

/** Áp dụng credits của phụ huynh để trừ tiền hóa đơn. */
export async function applyCredit(
  centerId: number | null,
  id: number,
  creditId: number,
  actor?: AuditActor
): Promise<{ applied: number; status: string }> {
  await assertInvoiceScope(centerId, id);
  if (!creditId) throw AppError.badRequest('Thiếu credit_id');
  try {
    const result = await applyCreditToInvoice(id, Number(creditId));
    await audit({
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
    if (err instanceof AppError) throw err;
    // Không lộ message DB ra client — log chi tiết để debug.
    logger.error('applyCredit thất bại', { invoiceId: id, creditId, ...formatError(err) });
    throw AppError.badRequest('Không thể áp dụng credits. Vui lòng thử lại sau.');
  }
}
