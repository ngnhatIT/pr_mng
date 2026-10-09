import { db, getCenterSetting, setCenterSetting } from '../../db';
import { notifyParents } from '../../services/notify';
import { afterInvoicePaid } from '../../services/referrals';
import { verifyVnpayReturn } from '../../services/vnpay';
import { maskAccessToken } from '../../services/zalo';
import { getDefaultCenter } from '../../utils/plans';
import { AppError } from '../../shared/errors';
import { audit, formatVND, type AuditActor } from '../../shared/audit';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { eventBus } from '../../shared/events/eventBus';
import { logger } from '../../shared/logger';
import { PaymentApprovedEvent, PaymentRejectedEvent } from '../../shared/events/finance.events';

const log = logger.scope('payments');

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

interface VnpayTxnRow {
  ref: string;
  invoice_id: number;
  amount: number;
  status: string;
}

type VnpayConfirmResult =
  | { kind: 'confirmed'; txnRef: string; already: boolean }
  | {
      kind: 'failed';
      reason: 'notfound' | 'invalid_signature' | 'payment_failed' | 'invalid_status' | 'error';
    };

/**
 * Logic xác nhận VNPay dùng chung cho return URL và IPN.
 * - Idempotent: txn đã 'confirmed' → trả thành công ngay, không ghi thêm payment.
 * - Chỉ xử lý txn 'pending'; các trạng thái khác → fail.
 * - Secret trống → từ chối (chống giả mạo callback khi chưa cấu hình).
 * - Check + confirm bọc trong transaction với SELECT ... FOR UPDATE (chống replay đồng thời).
 */
async function confirmVnpayTxn(
  query: Record<string, string | string[] | undefined>
): Promise<VnpayConfirmResult> {
  const txnRef = String(query.vnp_TxnRef || '');

  // Tra cứu nhanh (không lock) để phân loại sớm
  const txn = (await db.prepare('SELECT * FROM payment_txns WHERE ref = ?').get(txnRef)) as
    VnpayTxnRow | undefined;
  if (!txn) return { kind: 'failed', reason: 'notfound' };
  if (txn.status === 'confirmed') return { kind: 'confirmed', txnRef, already: true };
  if (txn.status !== 'pending') return { kind: 'failed', reason: 'invalid_status' };

  const inv = (await db
    .prepare('SELECT id, student_id, amount FROM invoices WHERE id = ?')
    .get(txn.invoice_id)) as { id: number; student_id: number; amount: number } | undefined;
  if (!inv) return { kind: 'failed', reason: 'notfound' };

  const student = (await db
    .prepare('SELECT id, center_id FROM students WHERE id = ?')
    .get(inv.student_id)) as { id: number; center_id: number | null } | undefined;
  const centerId = student?.center_id ?? 0;
  const secret = await getCenterSetting(centerId, 'pay_vnp_hashsecret');
  // Secret trống → không thể verify chữ ký thật → từ chối ngay (chống giả mạo)
  if (!secret) return { kind: 'failed', reason: 'invalid_signature' };

  const result = verifyVnpayReturn(query, secret);
  if (!result.ok) return { kind: 'failed', reason: 'invalid_signature' };
  if (!result.success) {
    await db
      .prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'")
      .run(txnRef);
    return { kind: 'failed', reason: 'payment_failed' };
  }
  // Kiểm tra số tiền khớp (dung sai ±1đ)
  if (Math.abs(result.amountVnd - txn.amount) > 1) {
    await db
      .prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'")
      .run(txnRef);
    return { kind: 'failed', reason: 'payment_failed' };
  }

  const amount = Math.round(txn.amount);
  const confirmed = await db.transaction(async (tx) => {
    // Lock row txn: request replay đồng thời sẽ chờ và thấy status != 'pending'
    const locked = (await tx
      .prepare('SELECT status FROM payment_txns WHERE ref = ? FOR UPDATE')
      .get(txnRef)) as { status: string } | undefined;
    if (!locked) return { kind: 'failed', reason: 'notfound' } as VnpayConfirmResult;
    if (locked.status === 'confirmed')
      return { kind: 'confirmed', txnRef, already: true } as VnpayConfirmResult;
    if (locked.status !== 'pending')
      return { kind: 'failed', reason: 'invalid_status' } as VnpayConfirmResult;

    await tx
      .prepare("UPDATE payment_txns SET status = 'confirmed' WHERE ref = ? AND status = 'pending'")
      .run(txnRef);
    await tx
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'vnpay', ?, 'confirmed')"
      )
      .run(txn.invoice_id, amount, 'VNPay ' + String(query.vnp_TransactionNo || ''));
    // Recalc trạng thái hóa đơn NGAY trong transaction (tx-scoped, thấy INSERT vừa rồi)
    const paidRow = (await tx
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(txn.invoice_id)) as { paid: number };
    const newStatus = Number(paidRow.paid) >= inv.amount - 0.01 ? 'paid' : 'partial';
    await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, txn.invoice_id);
    return { kind: 'confirmed', txnRef, already: false, status: newStatus } as VnpayConfirmResult & {
      status: string;
    };
  });

  if (confirmed.kind === 'confirmed' && !confirmed.already) {
    if ((confirmed as { status?: string }).status === 'paid') {
      await afterInvoicePaid(txn.invoice_id);
    }
  }
  return confirmed;
}

/**
 * Xử lý VNPay return (public — VNPay gọi về, không có token).
 * Trả về URL để redirect (luôn thành công ở tầng HTTP, lỗi thể hiện qua query).
 */
export async function handleVnpayReturn(
  query: Record<string, string | string[] | undefined>
): Promise<string> {
  const fail = (reason: string): string => `${RESULT_PAGE}?status=fail&reason=${reason}`;
  try {
    const r = await confirmVnpayTxn(query);
    if (r.kind === 'confirmed') {
      return `${RESULT_PAGE}?status=success&ref=${encodeURIComponent(r.txnRef)}`;
    }
    return fail(r.reason);
  } catch (err) {
    log.error('handleVnpayReturn error', {
      ref: String(query.vnp_TxnRef || ''),
      error: String(err),
    });
    return fail('error');
  }
}

/**
 * Xử lý VNPay IPN (server-to-server, VNPay gọi trực tiếp).
 * Trả về { RspCode, Message } theo chuẩn VNPay để VNPay biết đã nhận.
 * Dùng khi phụ huynh đóng tab trước khi redirect về — IPN vẫn xác nhận thanh toán.
 */
export async function handleVnpayIpn(
  query: Record<string, string | string[] | undefined>
): Promise<{ RspCode: string; Message: string }> {
  try {
    const r = await confirmVnpayTxn(query);
    if (r.kind === 'confirmed') {
      return { RspCode: '00', Message: 'Confirm Success' };
    }
    switch (r.reason) {
      case 'notfound':
        return { RspCode: '01', Message: 'Order not found' };
      case 'invalid_status':
        return { RspCode: '02', Message: 'Order already confirmed' };
      case 'invalid_signature':
        return { RspCode: '97', Message: 'Invalid signature' };
      case 'payment_failed':
        return { RspCode: '04', Message: 'Invalid amount' };
      default:
        return { RspCode: '99', Message: 'Unknown error' };
    }
  } catch (err) {
    log.error('handleVnpayIpn error', {
      ref: String(query.vnp_TxnRef || ''),
      error: String(err),
    });
    return { RspCode: '99', Message: 'Unknown error' };
  }
}

/* --------------------------- Duyệt thanh toán --------------------------- */

export async function listPendingPayments(
  centerId: number | null,
  pageOpts: PageOptions = {}
): Promise<Paginated<unknown>> {
  const conds = ["p.status = 'pending'"];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('s.center_id = ?');
    params.push(centerId);
  }
  const { page, limit, offset } = parsePagination(pageOpts);
  const from = `FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = i.student_id WHERE ${conds.join(' AND ')}`;
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from}`).get(...params)) as { c: number }).c;
  const rows = (await db
    .prepare(
      `SELECT p.id, p.invoice_id, p.amount, p.paid_at, p.method, p.note,
         s.name as student_name, s.code as student_code
       ${from} ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as unknown[];
  return paginate(rows, total, page, limit);
}

/** Duyệt / từ chối khoản thanh toán chờ (staff) — có kiểm tra center. */

async function notifyPaymentResult(
  studentId: number,
  amount: number,
  invoiceId: number,
  approved: boolean
): Promise<void> {
  const money = Number(amount).toLocaleString('vi-VN');
  await notifyParents(
    studentId,
    'payment_confirmed',
    approved
      ? `Trung tâm đã xác nhận thanh toán ${money}đ cho hóa đơn HD${invoiceId}. Xin cảm ơn!`
      : `Khoản thanh toán ${money}đ cho hóa đơn HD${invoiceId} đã bị từ chối. Vui lòng liên hệ trung tâm để được hỗ trợ.`,
    invoiceId
  );
}

/**
 * Lấy khoản chờ duyệt kèm center_id (qua payments → invoices → students).
 * Không tồn tại hoặc khác center → 404 (chống IDOR cross-center).
 */
async function getScopedPendingPayment(
  centerId: number | null,
  id: number
): Promise<{
  id: number;
  invoice_id: number;
  amount: number;
  status: string;
  student_id: number;
  center_id: number | null;
}> {
  const row = (await db
    .prepare(
      `SELECT p.id, p.invoice_id, p.amount, p.status, s.id as student_id, s.center_id
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN students s ON s.id = i.student_id
       WHERE p.id = ?`
    )
    .get(id)) as
    | {
        id: number;
        invoice_id: number;
        amount: number;
        status: string;
        student_id: number;
        center_id: number | null;
      }
    | undefined;
  if (!row || row.status !== 'pending' || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy khoản thanh toán đang chờ duyệt');
  }
  return row;
}

export async function approvePendingPayment(
  centerId: number | null,
  id: number,
  actor?: AuditActor
): Promise<{ status: string }> {
  const payment = await getScopedPendingPayment(centerId, id);
  const amount = Math.round(payment.amount);
  const status = await db.transaction(async (tx) => {
    // Lock hóa đơn: chống 2 lượt duyệt đồng thời cùng làm overpay
    const inv = (await tx
      .prepare('SELECT amount FROM invoices WHERE id = ? FOR UPDATE')
      .get(payment.invoice_id)) as { amount: number } | undefined;
    if (!inv) throw AppError.notFound('Không tìm thấy phiếu thu');
    const paidRow = (await tx
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(payment.invoice_id)) as { paid: number };
    const paidSoFar = Number(paidRow.paid);
    if (paidSoFar + amount > inv.amount + 0.01) {
      throw AppError.badRequest(
        `Duyệt khoản này sẽ làm hóa đơn bị thu vượt (còn nợ ${(inv.amount - paidSoFar).toLocaleString('vi-VN')}đ)`
      );
    }
    // Chống double-approve đồng thời: chỉ update khi còn pending
    const r = await tx
      .prepare("UPDATE payments SET status = 'confirmed' WHERE id = ? AND status = 'pending'")
      .run(id);
    if ((r.changes ?? 0) !== 1) {
      throw AppError.conflict('Khoản thanh toán đã được xử lý bởi người khác');
    }
    const newStatus = paidSoFar + amount >= inv.amount - 0.01 ? 'paid' : 'partial';
    await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, payment.invoice_id);
    return newStatus;
  });
  if (status === 'paid') await afterInvoicePaid(payment.invoice_id);
  await notifyPaymentResult(payment.student_id, amount, payment.invoice_id, true).catch((err) =>
    log.warn('notifyPaymentResult failed', { error: String(err) })
  );
  void audit({
    centerId: payment.center_id,
    actor,
    action: 'approve',
    entity: 'payments',
    entityId: id,
    summary: `Duyệt thanh toán ${formatVND(amount)} cho HD${payment.invoice_id}`,
    meta: { amount, invoice_id: payment.invoice_id },
  });
  eventBus.emitSync(new PaymentApprovedEvent(id, payment.invoice_id, amount, payment.center_id));
  return { status };
}

export async function rejectPendingPayment(
  centerId: number | null,
  id: number,
  actor?: AuditActor
): Promise<void> {
  const payment = await getScopedPendingPayment(centerId, id);
  const r = await db
    .prepare("UPDATE payments SET status = 'rejected' WHERE id = ? AND status = 'pending'")
    .run(id);
  if ((r.changes ?? 0) !== 1) {
    throw AppError.conflict('Khoản thanh toán đã được xử lý bởi người khác');
  }
  await notifyPaymentResult(payment.student_id, payment.amount, payment.invoice_id, false).catch((err) =>
    log.warn('notifyPaymentResult failed', { error: String(err) })
  );
  void audit({
    centerId: payment.center_id,
    actor,
    action: 'reject',
    entity: 'payments',
    entityId: id,
    summary: `Từ chối thanh toán ${formatVND(payment.amount)} cho HD${payment.invoice_id}`,
    meta: { amount: payment.amount, invoice_id: payment.invoice_id },
  });
  eventBus.emitSync(new PaymentRejectedEvent(id, payment.invoice_id));
}

/**
 * Hoàn tiền cho hóa đơn (staff, quyền payments.refund).
 * Ghi nhận dưới dạng payment âm với method='refund' — tự động trừ vào công nợ
 * ở mọi nơi tính SUM(payments confirmed), không cần sửa logic nào khác.
 * - Chỉ hoàn được số đã thu thực (net paid > 0), không hoàn vượt.
 * - Transaction + FOR UPDATE chống 2 lượt hoàn đồng thời vượt số đã thu.
 */
export async function refundInvoice(
  centerId: number | null,
  invoiceId: number,
  input: { amount: number; reason?: string | null },
  actor?: AuditActor
): Promise<{ refunded: number; status: string }> {
  const amt = Math.round(Number(input.amount));
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('Số tiền hoàn phải lớn hơn 0');
  // Scope: hóa đơn phải thuộc center (qua học viên)
  const scope = (await db
    .prepare('SELECT s.center_id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?')
    .get(invoiceId)) as { center_id: number | null } | undefined;
  if (!scope || (centerId !== null && scope.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy phiếu thu');
  }
  const status = await db.transaction(async (tx) => {
    const inv = (await tx
      .prepare('SELECT id, amount FROM invoices WHERE id = ? FOR UPDATE')
      .get(invoiceId)) as { id: number; amount: number } | undefined;
    if (!inv) throw AppError.notFound('Không tìm thấy phiếu thu');
    const paidRow = (await tx
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(invoiceId)) as { paid: number };
    const netPaid = Number(paidRow.paid);
    if (netPaid <= 0) throw AppError.badRequest('Hóa đơn chưa có khoản thu nào để hoàn');
    if (amt > netPaid + 0.01) {
      throw AppError.badRequest(`Chỉ hoàn được tối đa ${netPaid.toLocaleString('vi-VN')}đ (số đã thu thực)`);
    }
    await tx
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'refund', ?, 'confirmed')"
      )
      .run(invoiceId, -amt, input.reason?.trim() || 'Hoàn tiền');
    const newStatus = netPaid - amt >= inv.amount - 0.01 ? 'paid' : netPaid - amt > 0 ? 'partial' : 'unpaid';
    await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, invoiceId);
    return newStatus;
  });
  void audit({
    centerId,
    actor,
    action: 'refund',
    entity: 'invoices',
    entityId: invoiceId,
    summary: `Hoàn ${formatVND(amt)} cho HD${invoiceId}${input.reason ? `: ${input.reason}` : ''}`,
    meta: { amount: amt, reason: input.reason ?? null },
  });
  return { refunded: amt, status };
}

/* ---------------------------- Cấu hình thanh toán ---------------------------- */

async function resolveConfigCenterId(centerId: number | null): Promise<number> {
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

export async function savePaymentConfig(
  centerId: number | null,
  body: Record<string, unknown>
): Promise<void> {
  const cid = await resolveConfigCenterId(centerId);
  for (const k of CONFIG_KEYS) {
    if (!(k in body)) continue;
    let value = String(body[k] ?? '');
    // Defense in depth: client không gửi secret đã che, nhưng nếu có gửi
    // (giá trị '••••••••') thì BỎ QUA — không ghi đè secret/token thật.
    if (value === '••••••••' || /•/.test(value)) continue;
    if (k === 'pay_vnp_enabled') value = value === '1' ? '1' : '0';
    await setCenterSetting(cid, k, value);
  }
}
