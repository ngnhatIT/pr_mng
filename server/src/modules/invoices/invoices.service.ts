import { db, recalcInvoiceStatus } from '../../db';
import { afterInvoicePaid, applyCreditToInvoice } from '../../services/referrals';
import { AppError } from '../../shared/errors';
import { escapeLike } from '../../shared/like';
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
async function assertInvoiceScope(centerId: number | null, invoiceId: number): Promise<void> {
  const row = (await db
    .prepare('SELECT s.center_id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?')
    .get(invoiceId)) as { center_id: number | null } | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy phiếu thu');
  }
}

function assertPositiveAmount(amount: unknown): number {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('Số tiền phải lớn hơn 0');
  // VND không có xu lẻ — làm tròn mọi số tiền ở biên vào
  return Math.round(amt);
}

/* --------------------------------- Service --------------------------------- */

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
    conds.push('(s.name LIKE ? ESCAPE "\\" OR s.code LIKE ? ESCAPE "\\")');
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
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'confirmed'), 0) as paid
       ${from} ORDER BY i.id DESC LIMIT ? OFFSET ?`
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
  const base = `FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${conds.join(' AND ')}`;
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM (SELECT s.id ${base} GROUP BY s.id)`).get(...params)) as {
      c: number;
    }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone,
         SUM(i.amount) as total,
         COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed')), 0) as paid,
         STRING_AGG(i.id || ':' || COALESCE(i.due_date, ''), ',' ORDER BY i.id) as invoice_dues
       ${base}
       GROUP BY s.id, s.code, s.name, s.phone
       ORDER BY (SUM(i.amount) - COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed')), 0)) DESC
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
         COALESCE(SUM(i.amount - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed'), 0)), 0) as totalDebt,
         COUNT(DISTINCT s.id) as debtorCount
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE ${conds.join(' AND ')}`
    )
    .get(...params)) as { totalDebt: number; debtorCount: number };
  return { totalDebt: row.totalDebt || 0, debtorCount: row.debtorCount || 0 };
}

export async function getInvoiceDetail(
  centerId: number | null,
  id: number
): Promise<Record<string, unknown>> {
  await assertInvoiceScope(centerId, id);
  const inv = await db
    .prepare(
      `SELECT i.*, s.name as student_name, s.code as student_code, c.name as class_name
       FROM invoices i JOIN students s ON s.id = i.student_id
       LEFT JOIN classes c ON c.id = i.class_id WHERE i.id = ?`
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
  const current = (await db.prepare('SELECT amount FROM invoices WHERE id = ?').get(id)) as
    { amount: number } | undefined;
  if (current && Math.round(current.amount) !== amt) {
    // Chặn sửa số tiền khi đã có thanh toán được xác nhận (tránh xóa nợ / tạo nợ ảo)
    const confirmed = (
      (await db
        .prepare("SELECT COUNT(*) as c FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
        .get(id)) as {
        c: number;
      }
    ).c;
    if (confirmed > 0) {
      throw AppError.badRequest('Không thể sửa số tiền của phiếu thu đã có thanh toán được xác nhận');
    }
  }
  await db
    .prepare('UPDATE invoices SET amount = ?, due_date = ?, note = ? WHERE id = ?')
    .run(amt, input.due_date || null, input.note || null, id);
  await recalcInvoiceStatus(id);
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
  const inv = (await db.prepare('SELECT amount FROM invoices WHERE id = ?').get(id)) as
    { amount: number } | undefined;
  // Chặn xóa cứng hóa đơn đã có thanh toán được xác nhận (tránh mất dữ liệu tài chính)
  const confirmed = (
    (await db
      .prepare("SELECT COUNT(*) as c FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
      .get(id)) as {
      c: number;
    }
  ).c;
  if (confirmed > 0) {
    throw AppError.badRequest('Không thể xóa phiếu thu đã có thanh toán được xác nhận');
  }
  await db.transaction(async (tx) => {
    // Hoàn lại credits đã áp dụng (payments method='credit' lưu credit_id trong note)
    const creditPays = (await tx
      .prepare("SELECT amount, note FROM payments WHERE invoice_id = ? AND method = 'credit'")
      .all(id)) as { amount: number; note: string | null }[];
    for (const p of creditPays) {
      const m = /credits #(\d+)/.exec(p.note || '');
      if (m) {
        await tx
          .prepare('UPDATE credits SET used_amount = GREATEST(used_amount - ?, 0) WHERE id = ?')
          .run(Math.round(Number(p.amount)), Number(m[1]));
      }
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
    summary: `Xóa phiếu thu HD${id}${inv ? `: ${formatVND(inv.amount)}` : ''}`,
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
      .run(
        id,
        amt,
        input.paid_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        input.method || 'Tiền mặt',
        input.note || null
      );
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
    summary: `Thu ${formatVND(amt)} cho HD${id} (${input.method || 'Tiền mặt'})`,
    meta: { amount: amt, method: input.method },
  });
  return { status };
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
    throw AppError.badRequest(err instanceof Error ? err.message : 'Không thể áp dụng credits');
  }
}
