import { db, recalcInvoiceStatus, getCenterSetting, setCenterSetting } from '../../db';
import { notifyParents } from '../../services/notify';
import { afterInvoicePaid } from '../../services/referrals';
import { verifyVnpayReturn } from '../../services/vnpay';
import { maskAccessToken } from '../../services/zalo';
import { getDefaultCenter } from '../../utils/plans';
import { AppError } from '../../shared/errors';
import { audit, formatVND, type AuditActor } from '../../shared/audit';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { eventBus } from '../../shared/events/eventBus';
import { PaymentApprovedEvent, PaymentRejectedEvent } from '../../shared/events/finance.events';

/* ---------------------------------- Types ---------------------------------- */

export const RESULT_PAGE = '/parent/thanh-toan-ket-qua';

const CONFIG_KEYS = [
  'pay_bank_code',
  'pay_bank_account_no',
  'pay_bank_account_name',
  'pay_vnp_tmncode',
  'pay_vnp_enabled',
  'pay_vnp_hashsecret',
  'referral_reward_referrer',
  'referral_reward_referred',
] as const;

/* ------------------------------ VNPay callback ------------------------------ */

/**
 * Xử lý VNPay return (public — VNPay gọi về, không có token).
 * Trả về URL để redirect (luôn thành công ở tầng HTTP, lỗi thể hiện qua query).
 */
export async function handleVnpayReturn(
  query: Record<string, string | string[] | undefined>
): Promise<string> {
  const fail = (reason: string): string =>
    `${RESULT_PAGE}?status=fail&reason=${reason}`;
  try {
    const txnRef = String(query.vnp_TxnRef || '');
    const txn = (await db.prepare('SELECT * FROM payment_txns WHERE ref = ?').get(txnRef)) as
      { ref: string; invoice_id: number; amount: number; status: string } | undefined;
    if (!txn) return fail('notfound');

    const inv = (await db.prepare('SELECT id, student_id, amount FROM invoices WHERE id = ?').get(txn.invoice_id)) as
      { id: number; student_id: number; amount: number } | undefined;
    if (!inv) return fail('notfound');

    const student = (await db.prepare('SELECT id, center_id FROM students WHERE id = ?').get(inv.student_id)) as
      { id: number; center_id: number | null } | undefined;
    const centerId = student?.center_id ?? 0;
    const secret = await getCenterSetting(centerId, 'pay_vnp_hashsecret');
    const result = verifyVnpayReturn(query, secret);
    if (!result.ok) return fail('invalid_signature');
    if (!result.success) {
      await db.prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ?").run(txnRef);
      return fail('payment_failed');
    }
    // Kiểm tra số tiền khớp (dung sai ±1đ)
    if (Math.abs(result.amountVnd - txn.amount) > 1) {
      await db.prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ?").run(txnRef);
      return fail('payment_failed');
    }
    await db.transaction(async (tx) => {
      await tx.prepare("UPDATE payment_txns SET status = 'confirmed' WHERE ref = ?").run(txnRef);
      await tx.prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'vnpay', ?, 'confirmed')"
      ).run(txn.invoice_id, txn.amount, 'VNPay ' + String(query.vnp_TransactionNo || ''));
    });
    const status = await recalcInvoiceStatus(txn.invoice_id);
    if (status === 'paid') await afterInvoicePaid(txn.invoice_id);
    return `${RESULT_PAGE}?status=success&ref=${encodeURIComponent(txnRef)}`;
  } catch {
    return fail('error');
  }
}

/* --------------------------- Duyệt thanh toán --------------------------- */

export async function listPendingPayments(centerId: number | null, pageOpts: PageOptions = {}):  Promise<Paginated<unknown>> {
  const conds = ["p.status = 'pending'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const { page, limit, offset } = parsePagination(pageOpts);
  const from = `FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = i.student_id WHERE ${conds.join(' AND ')}`;
  const total = (await db.prepare(`SELECT COUNT(*) as c ${from}`).get(...params) as { c: number }).c;
  const rows = await db.prepare(
      `SELECT p.id, p.invoice_id, p.amount, p.paid_at, p.method, p.note,
         s.name as student_name, s.code as student_code
       ${from} ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as unknown[];
  return paginate(rows, total, page, limit);
}

async function getPendingPayment(id: number): Promise<{ id: number; invoice_id: number; amount: number; status: string; }> {
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as
    { id: number; invoice_id: number; amount: number; status: string } | undefined;
  if (!payment || payment.status !== 'pending') {
    throw AppError.notFound('Không tìm thấy khoản thanh toán đang chờ duyệt');
  }
  return payment;
}

async function notifyPaymentResult(studentId: number, amount: number, invoiceId: number, approved: boolean): Promise<void> {
  const money = Number(amount).toLocaleString('vi-VN');
  notifyParents(
    studentId,
    'payment_confirmed',
    approved
      ? `Trung tâm đã xác nhận thanh toán ${money}đ cho hóa đơn HD${invoiceId}. Xin cảm ơn!`
      : `Khoản thanh toán ${money}đ cho hóa đơn HD${invoiceId} đã bị từ chối. Vui lòng liên hệ trung tâm để được hỗ trợ.`,
    invoiceId
  );
}

export async function approvePendingPayment(id: number, actor?: AuditActor): Promise<{ status: string; }> {
  const payment = await getPendingPayment(id);
  await db.prepare("UPDATE payments SET status = 'confirmed' WHERE id = ?").run(id);
  const status = await recalcInvoiceStatus(payment.invoice_id);
  if (status === 'paid') await afterInvoicePaid(payment.invoice_id);
  const inv = await db.prepare('SELECT student_id FROM invoices WHERE id = ?').get(payment.invoice_id) as
    { student_id: number } | undefined;
  if (inv) await notifyPaymentResult(inv.student_id, payment.amount, payment.invoice_id, true);
  const cid = inv
    ? ((
        await db.prepare('SELECT center_id FROM students WHERE id = ?').get(inv.student_id) as
          { center_id: number | null } | undefined
      )?.center_id ?? null)
    : null;
  audit({
    centerId: cid,
    actor,
    action: 'approve',
    entity: 'payments',
    entityId: id,
    summary: `Duyệt thanh toán ${formatVND(payment.amount)} cho HD${payment.invoice_id}`,
    meta: { amount: payment.amount, invoice_id: payment.invoice_id },
  });
  eventBus.emitSync(new PaymentApprovedEvent(id, payment.invoice_id, payment.amount, cid));
  return { status };
}

export async function rejectPendingPayment(id: number, actor?: AuditActor): Promise<void> {
  const payment = await getPendingPayment(id);
  await db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(id);
  const inv = await db.prepare('SELECT student_id FROM invoices WHERE id = ?').get(payment.invoice_id) as
    { student_id: number } | undefined;
  if (inv) await notifyPaymentResult(inv.student_id, payment.amount, payment.invoice_id, false);
  const cid = inv
    ? ((
        await db.prepare('SELECT center_id FROM students WHERE id = ?').get(inv.student_id) as
          { center_id: number | null } | undefined
      )?.center_id ?? null)
    : null;
  audit({
    centerId: cid,
    actor,
    action: 'reject',
    entity: 'payments',
    entityId: id,
    summary: `Từ chối thanh toán ${formatVND(payment.amount)} cho HD${payment.invoice_id}`,
    meta: { amount: payment.amount, invoice_id: payment.invoice_id },
  });
  eventBus.emitSync(new PaymentRejectedEvent(id, payment.invoice_id));
}

/* ---------------------------- Cấu hình thanh toán ---------------------------- */

async function resolveConfigCenterId(centerId: number | null):  Promise<number> {
  if (centerId !== null) return centerId;
  const c = await getDefaultCenter();
  if (!c) throw AppError.badRequest('Chưa có trung tâm nào trong hệ thống');
  return c.id;
}

/** Xem cấu hình — hashsecret được che. */
export async function getPaymentConfig(centerId: number | null): Promise<Record<string, string>> {
  const cid = await resolveConfigCenterId(centerId);
  const out: Record<string, string> = {};
  for (const k of CONFIG_KEYS) {
    const v = await getCenterSetting(cid, k);
    out[k] = k === 'pay_vnp_hashsecret' ? maskAccessToken(v) : v;
  }
  return out;
}

export async function savePaymentConfig(centerId: number | null, body: Record<string, unknown>): Promise<void> {
  const cid = await resolveConfigCenterId(centerId);
  for (const k of CONFIG_KEYS) {
    if (!(k in body)) continue;
    let value = String(body[k] ?? '');
    if (k === 'pay_vnp_enabled') value = value === '1' ? '1' : '0';
    await setCenterSetting(cid, k, value);
  }
}
