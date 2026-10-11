import { db, getCenterSetting, getCenterSettings, setCenterSetting } from '../../db';
import { notifyParents } from '../../services/notify';
import { afterInvoicePaid, revokeReferralReward, reportReferralRevoke } from '../referrals/rewards.service';
import { verifyVnpayReturn, type VnpayVerifyResult } from '../../services/vnpay';
import { sendAlert } from '../../shared/alert';
import { maskAccessToken, isKeepSecret } from '../../services/zalo';
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
  center_id: number | null;
}

export type VnpayConfirmResult =
  | { kind: 'confirmed'; txnRef: string; already: boolean }
  | {
      kind: 'failed';
      reason:
        | 'notfound'
        | 'invalid_signature'
        | 'payment_failed'
        | 'invalid_amount'
        | 'invalid_status'
        | 'needs_review'
        | 'error';
    };

const fail = (reason: Extract<VnpayConfirmResult, { kind: 'failed' }>['reason']): VnpayConfirmResult => ({
  kind: 'failed',
  reason,
});

/**
 * PAY-7: tra txn + xác thực chữ ký TRƯỚC khi tiết lộ txn có tồn tại / đã xác nhận hay chưa.
 * Secret lấy theo center của hóa đơn; txn không tồn tại (VD hóa đơn đã xóa) thì thử
 * các center có cùng vnp_TmnCode để vẫn verify được (IPN thật -> alert, giả mạo -> 97).
 */
async function verifyVnpayQuery(
  query: Record<string, string | string[] | undefined>
): Promise<{ ok: boolean; txn?: VnpayTxnRow; result?: VnpayVerifyResult }> {
  const txnRef = String(query.vnp_TxnRef || '');
  const txn = (await db
    .prepare(
      `SELECT t.ref, t.invoice_id, t.amount, t.status, s.center_id
       FROM payment_txns t JOIN invoices i ON i.id = t.invoice_id JOIN students s ON s.id = i.student_id
       WHERE t.ref = ?`
    )
    .get(txnRef)) as VnpayTxnRow | undefined;
  const centerIds = txn
    ? [txn.center_id ?? 0]
    : (
        (await db
          .prepare("SELECT center_id FROM center_settings WHERE key = 'pay_vnp_tmncode' AND value = ?")
          .all(String(query.vnp_TmnCode || ''))) as { center_id: number }[]
      ).map((r) => r.center_id);
  for (const cid of centerIds) {
    // Secret trống -> không verify được chữ ký thật -> coi như sai chữ ký (chống giả mạo)
    const secret = await getCenterSetting(cid, 'pay_vnp_hashsecret');
    const result = verifyVnpayReturn(query, secret);
    if (result.ok) return { ok: true, txn, result };
  }
  return { ok: false, txn };
}

/**
 * Logic xác nhận VNPay — dùng cho IPN handler (G2) và đối soát querydr (preVerified: chữ ký
 * querydr đã được verify theo định dạng riêng ở services/vnpay.ts).
 * - Idempotent: txn đã 'confirmed' → trả thành công ngay, không ghi thêm payment.
 * - Xử lý txn 'pending' (và 'failed' do đối soát bỏ cuộc — VNPay vẫn có thể đã trừ tiền).
 * - Check + confirm bọc trong transaction với SELECT ... FOR UPDATE (chống replay đồng thời).
 * - PAY-3: thu vượt / mất hóa đơn → KHÔNG bỏ tiền: txn 'needs_review' + payment pending + alert + audit.
 */
async function confirmVnpayTxn(
  query: Record<string, string | string[] | undefined>,
  opts: { preVerified?: boolean } = {}
): Promise<VnpayConfirmResult> {
  const txnRef = String(query.vnp_TxnRef || '');
  let txn: VnpayTxnRow | undefined;
  let success: boolean;
  let amountVnd: number;
  if (opts.preVerified) {
    txn = (await db
      .prepare(
        `SELECT t.ref, t.invoice_id, t.amount, t.status, s.center_id
         FROM payment_txns t JOIN invoices i ON i.id = t.invoice_id JOIN students s ON s.id = i.student_id
         WHERE t.ref = ?`
      )
      .get(txnRef)) as VnpayTxnRow | undefined;
    success = query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';
    amountVnd = Math.round(Number(query.vnp_Amount || 0) / 100);
  } else {
    const v = await verifyVnpayQuery(query);
    if (!v.ok || !v.result) return fail('invalid_signature');
    txn = v.txn;
    success = v.result.success;
    amountVnd = v.result.amountVnd;
  }
  if (!txn) {
    // Chữ ký hợp lệ nhưng không có txn (hóa đơn đã bị xóa?) — có thể VNPay đã trừ tiền phụ huynh
    if (success) {
      await sendAlert(
        'VNPay: IPN cho giao dịch không tồn tại',
        `Ref ${txnRef}, số tiền ${formatVND(amountVnd)}, mã GD VNPay ${String(query.vnp_TransactionNo || '')} — cần đối soát tay`
      );
    }
    return fail('notfound');
  }
  if (txn.status === 'confirmed') return { kind: 'confirmed', txnRef, already: true };
  if (txn.status !== 'pending' && txn.status !== 'failed') return fail('invalid_status');

  if (!success) {
    // PAY-6: giao dịch thất bại/hủy hợp lệ → cập nhật trạng thái, IPN vẫn trả 00 (đã nhận)
    await db
      .prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'")
      .run(txnRef);
    return fail('payment_failed');
  }
  // Kiểm tra số tiền khớp (dung sai ±1đ)
  if (Math.abs(amountVnd - txn.amount) > 1) {
    await db
      .prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'")
      .run(txnRef);
    return fail('invalid_amount');
  }

  const amount = Math.round(txn.amount);
  const centerId = txn.center_id;
  const vnpNo = String(query.vnp_TransactionNo || '');
  const outcome = await db.transaction(async (tx) => {
    // Lock row txn: request replay đồng thời sẽ chờ và thấy status mới
    const locked = (await tx
      .prepare('SELECT status FROM payment_txns WHERE ref = ? FOR UPDATE')
      .get(txnRef)) as { status: string } | undefined;
    if (!locked) return { r: fail('notfound') };
    if (locked.status === 'confirmed')
      return { r: { kind: 'confirmed', txnRef, already: true } as VnpayConfirmResult };
    if (locked.status !== 'pending' && locked.status !== 'failed') return { r: fail('invalid_status') };

    // Lock hóa đơn: 2 callback VNPay đồng thời cho 2 txn khác nhau của cùng 1 hóa đơn
    // sẽ serialize tại đây, tránh cả hai cùng đọc paidSoFar=0 và overpay
    const inv = (await tx
      .prepare('SELECT id, amount, status FROM invoices WHERE id = ? FOR UPDATE')
      .get(txn.invoice_id)) as { id: number; amount: number; status: string } | undefined;
    const paidSoFar = inv
      ? Number(
          (
            (await tx
              .prepare(
                "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
              )
              .get(txn.invoice_id)) as { paid: number }
          ).paid
        )
      : 0;
    if (!inv || paidSoFar + amount > inv.amount + 0.01) {
      // PAY-3: VNPay đã trừ tiền nhưng ghi nhận sẽ thu vượt → giữ dấu vết, chờ nhân viên xử lý
      await tx.prepare("UPDATE payment_txns SET status = 'needs_review' WHERE ref = ?").run(txnRef);
      if (inv) {
        await tx
          .prepare(
            "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'vnpay', ?, 'pending')"
          )
          .run(inv.id, amount, `VNPay ${vnpNo} — thu vượt, cần hoàn/đối soát (${txnRef})`);
      }
      return { r: fail('needs_review'), overpay: true };
    }
    await tx
      .prepare(
        "UPDATE payment_txns SET status = 'confirmed' WHERE ref = ? AND status IN ('pending', 'failed')"
      )
      .run(txnRef);
    await tx
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'vnpay', ?, 'confirmed')"
      )
      .run(txn.invoice_id, amount, 'VNPay ' + vnpNo);
    // Recalc trạng thái hóa đơn NGAY trong transaction
    const newStatus = paidSoFar + amount >= inv.amount - 0.01 ? 'paid' : 'partial';
    if (newStatus !== inv.status) {
      await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, txn.invoice_id);
    }
    return {
      r: { kind: 'confirmed', txnRef, already: false } as VnpayConfirmResult,
      paid: newStatus === 'paid',
    };
  });

  if (outcome.overpay) {
    const detail = `Ref ${txnRef}, HD${txn.invoice_id}, ${formatVND(amount)} (mã GD VNPay ${vnpNo}) — tiền đã trừ nhưng vượt số còn nợ`;
    await sendAlert('VNPay: thanh toán thu vượt cần xử lý', detail);
    await audit({
      centerId,
      action: 'vnpay_needs_review',
      entity: 'invoices',
      entityId: txn.invoice_id,
      summary: `VNPay thu vượt ${formatVND(amount)} cho HD${txn.invoice_id} — cần xử lý`,
      meta: { ref: txnRef, amount, vnp_TransactionNo: vnpNo },
    });
  } else if (outcome.r.kind === 'confirmed' && !outcome.r.already) {
    logger.info('VNPay payment confirmed', { txnRef, invoiceId: txn.invoice_id, amount, centerId });
    if (outcome.paid) await afterInvoicePaid(txn.invoice_id);
  }
  return outcome.r;
}

/**
 * G6: Đối soát đơn VNPay treo từ kết quả querydr (chữ ký querydr đã verify ở tầng gọi).
 * Đi đúng đường confirmVnpayTxn (check số tiền, chống overpay, thất bại → failed) —
 * không duplicate logic tiền.
 */
export async function reconcileVnpayTxn(qd: Record<string, string>): Promise<VnpayConfirmResult> {
  return confirmVnpayTxn(qd, { preVerified: true });
}

/**
 * Xử lý VNPay return (public — browser redirect, không có token).
 * G2: CHỈ verify chữ ký VNPay + đọc trạng thái từ payment_txns để hiển thị,
 * KHÔNG ghi gì. Mọi ghi nhận tiền chỉ diễn ra ở IPN handler (server-to-server).
 * Trả về URL để redirect (luôn thành công ở tầng HTTP, lỗi thể hiện qua query).
 */
export async function handleVnpayReturn(
  query: Record<string, string | string[] | undefined>
): Promise<string> {
  const failUrl = (reason: string): string => `${RESULT_PAGE}?status=fail&reason=${reason}`;
  try {
    const txnRef = String(query.vnp_TxnRef || '');
    const v = await verifyVnpayQuery(query);
    if (!v.ok || !v.result) return failUrl('invalid_signature');
    if (!v.txn) return failUrl('notfound');
    if (!v.result.success) return failUrl('payment_failed');
    // IPN (server-to-server) mới là nơi ghi nhận tiền; return về trước IPN -> pending.
    const status = v.txn.status === 'confirmed' ? 'success' : 'pending';
    return `${RESULT_PAGE}?status=${status}&ref=${encodeURIComponent(txnRef)}`;
  } catch (err) {
    log.error('handleVnpayReturn error', { ref: String(query.vnp_TxnRef || ''), error: String(err) });
    return failUrl('error');
  }
}

/**
 * Xử lý VNPay IPN (server-to-server, VNPay gọi trực tiếp).
 * Trả về { RspCode, Message } theo chuẩn VNPay để VNPay biết đã nhận.
 */
export async function handleVnpayIpn(
  query: Record<string, string | string[] | undefined>
): Promise<{ RspCode: string; Message: string }> {
  try {
    const r = await confirmVnpayTxn(query);
    if (r.kind === 'confirmed') return { RspCode: '00', Message: 'Confirm Success' };
    switch (r.reason) {
      // PAY-6/PAY-3: đã ghi nhận trạng thái (thất bại / cần xử lý) → báo VNPay đã nhận, không retry
      case 'payment_failed':
      case 'needs_review':
        return { RspCode: '00', Message: 'Confirm Success' };
      case 'notfound':
        return { RspCode: '01', Message: 'Order not found' };
      case 'invalid_status':
        return { RspCode: '02', Message: 'Order already confirmed' };
      case 'invalid_amount':
        return { RspCode: '04', Message: 'Invalid amount' };
      case 'invalid_signature':
        return { RspCode: '97', Message: 'Invalid signature' };
      default:
        return { RspCode: '99', Message: 'Unknown error' };
    }
  } catch (err) {
    log.error('handleVnpayIpn error', { ref: String(query.vnp_TxnRef || ''), error: String(err) });
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
  await audit({
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
  await audit({
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
 * PAY-2: hoàn tiền là ĐIỀU CHỈNH hóa đơn — số phải thu giảm đúng bằng số hoàn (invoices.amount -= amt),
 * nên công nợ/nhắc nợ ở mọi nơi (amount − SUM(confirmed)) không bị mở lại thành nợ ảo.
 * PAY-5: phần tiền mặt chỉ hoàn tối đa số đã thu KHÔNG phải credits; phần còn lại (đã trả bằng credits)
 * được trả lại vào credits của phụ huynh. Hoàn hết hóa đơn → thu hồi thưởng giới thiệu (nếu có).
 * Transaction + FOR UPDATE chống 2 lượt hoàn đồng thời vượt số đã thu.
 */
export async function refundInvoice(
  centerId: number | null,
  invoiceId: number,
  input: { amount: number; reason?: string | null },
  actor?: AuditActor
): Promise<{ refunded: number; cash: number; credit: number; status: string }> {
  const amt = Math.round(Number(input.amount));
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('Số tiền hoàn phải lớn hơn 0');
  // Scope: hóa đơn phải thuộc center (qua học viên)
  const scope = (await db
    .prepare('SELECT s.center_id FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?')
    .get(invoiceId)) as { center_id: number | null } | undefined;
  if (!scope || (centerId !== null && scope.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy phiếu thu');
  }
  const res = await db.transaction(async (tx) => {
    const inv = (await tx
      .prepare('SELECT id, amount FROM invoices WHERE id = ? FOR UPDATE')
      .get(invoiceId)) as { id: number; amount: number } | undefined;
    if (!inv) throw AppError.notFound('Không tìm thấy phiếu thu');
    const rows = (await tx
      .prepare(
        "SELECT id, amount, method, credit_id FROM payments WHERE invoice_id = ? AND status = 'confirmed' ORDER BY id DESC"
      )
      .all(invoiceId)) as { id: number; amount: number; method: string | null; credit_id: number | null }[];
    const netPaid = rows.reduce((t, r) => t + Number(r.amount), 0);
    if (netPaid <= 0) throw AppError.badRequest('Hóa đơn chưa có khoản thu nào để hoàn');
    if (amt > netPaid + 0.01) {
      throw AppError.badRequest(`Chỉ hoàn được tối đa ${netPaid.toLocaleString('vi-VN')}đ (số đã thu thực)`);
    }
    const creditRows = rows.filter((r) => r.method === 'credit');
    // Dòng refund (âm) luôn là tiền mặt — phần credits được hoàn bằng cách giảm chính dòng credit
    const cashRefundable = netPaid - creditRows.reduce((t, r) => t + Number(r.amount), 0);
    const cash = Math.max(0, Math.min(amt, Math.round(cashRefundable)));
    if (cash > 0) {
      await tx
        .prepare(
          "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'refund', ?, 'confirmed')"
        )
        .run(invoiceId, -cash, input.reason?.trim() || 'Hoàn tiền');
    }
    let creditLeft = amt - cash;
    const unrestored: { paymentId: number; creditId: number | null; amount: number }[] = [];
    for (const p of creditRows) {
      if (creditLeft <= 0) break;
      const take = Math.min(Number(p.amount), creditLeft);
      if (take >= Number(p.amount)) {
        await tx
          .prepare(
            "UPDATE payments SET status = 'rejected', note = COALESCE(note, '') || ' (đã hoàn lại credits)' WHERE id = ?"
          )
          .run(p.id);
      } else {
        await tx.prepare('UPDATE payments SET amount = amount - ? WHERE id = ?').run(take, p.id);
      }
      // S-1/O-2: trả lại đúng credit qua payments.credit_id, chỉ trong trung tâm của hóa đơn, và
      // không hồi sinh credit đã thu hồi (C-2). Không trả được -> alert để xử lý tay.
      const restored = p.credit_id
        ? await tx
            .prepare(
              'UPDATE credits SET used_amount = GREATEST(used_amount - ?, 0) WHERE id = ? AND center_id = ? AND voided_at IS NULL'
            )
            .run(take, p.credit_id, scope.center_id)
        : null;
      if ((restored?.changes ?? 0) !== 1)
        unrestored.push({ paymentId: p.id, creditId: p.credit_id, amount: take });
      creditLeft -= take;
    }
    const newAmount = Math.max(0, inv.amount - amt);
    const newNet = netPaid - amt;
    const status = newNet >= newAmount - 0.01 ? 'paid' : newNet > 0 ? 'partial' : 'unpaid';
    await tx
      .prepare('UPDATE invoices SET amount = ?, status = ? WHERE id = ?')
      .run(newAmount, status, invoiceId);
    // C-2: thu hồi thưởng giới thiệu cùng transaction với hoàn tiền
    const revoked = newNet <= 0.01 ? await revokeReferralReward(tx, invoiceId) : null;
    return { status, cash, credit: amt - cash, oldAmount: inv.amount, revoked, unrestored };
  });
  if (res.revoked) await reportReferralRevoke(invoiceId, res.revoked);
  if (res.unrestored.length > 0) {
    log.warn('refundInvoice: không trả lại được credits', { invoiceId, unrestored: res.unrestored });
    await sendAlert(
      'Hoàn tiền: không trả lại được credits',
      `HD${invoiceId}: ${res.unrestored.map((u) => `${formatVND(u.amount)} (credit #${u.creditId ?? '?'})`).join(', ')} — credit đã thu hồi/khác trung tâm/thiếu liên kết, cần xử lý tay`
    ).catch(() => undefined);
  }
  await audit({
    centerId: scope.center_id,
    actor,
    action: 'refund',
    entity: 'invoices',
    entityId: invoiceId,
    summary: `Hoàn ${formatVND(amt)} cho HD${invoiceId}${input.reason ? `: ${input.reason}` : ''}`,
    meta: {
      amount: amt,
      cash: res.cash,
      credit: res.credit,
      old_amount: res.oldAmount,
      new_amount: Math.max(0, res.oldAmount - amt),
      reason: input.reason ?? null,
    },
  });
  return { refunded: amt, cash: res.cash, credit: res.credit, status: res.status };
}

/* ---------------------------- Cấu hình thanh toán ---------------------------- */

/** Xem cấu hình — hashsecret được che. centerId bắt buộc (ARCH-1: route dùng requireCenterId). */
export async function getPaymentConfig(centerId: number): Promise<Record<string, string>> {
  const settings = await getCenterSettings(centerId, [...CONFIG_KEYS]);
  const out: Record<string, string> = {};
  for (const k of CONFIG_KEYS) {
    const v = settings.get(k) ?? '';
    out[k] = k === 'pay_vnp_hashsecret' ? maskAccessToken(v) : v;
  }
  return out;
}

export async function savePaymentConfig(centerId: number, body: Record<string, unknown>): Promise<void> {
  for (const k of CONFIG_KEYS) {
    if (!(k in body) || body[k] === undefined) continue;
    let value = String(body[k] ?? '');
    // DATA-5/ADM-9: secret đã che ('••••') hoặc rỗng = giữ nguyên, không ghi đè secret thật
    if (isKeepSecret(k, value)) continue;
    if (k === 'pay_vnp_enabled') value = value === '1' ? '1' : '0';
    await setCenterSetting(centerId, k, value);
  }
}
