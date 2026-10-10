import cron from 'node-cron';
import { db, getCenterSettings } from '../db';
import { queryVnpayTransaction } from '../services/vnpay';
import { reconcileVnpayTxn } from '../modules/payments/payments.service';
import { withAdvisoryLock } from '../shared/advisoryLock';
import { sendAlert } from '../shared/alert';
import { logger } from '../shared/logger';
import { formatError } from '../shared/errorFormat';

/**
 * G6: Đối soát đơn VNPay treo.
 * Đơn thanh toán có vnp_ExpireDate = tạo + 30 phút (VNPay không cho trả muộn).
 * Cron chạy mỗi 15 phút, tìm payment_txns còn 'pending' quá 60 phút
 * (30 phút hết hạn + 30 phút grace cho IPN/return về trễ) rồi gọi querydr:
 * - querydr '00'/'00' → confirmed qua đúng đường confirmVNPay (không duplicate logic tiền)
 * - querydr báo giao dịch thất bại → failed
 * - querydr lỗi/không gọi được → đánh failed + sendAlert để xử lý tay
 *   (đơn đã quá 60 phút trong khi VNPay hết hạn sau 30 phút nên không thể bị trừ tiền muộn)
 */

const log = logger.scope('vnpay-reconcile');
const VN_TZ = 'Asia/Ho_Chi_Minh';
const STUCK_AFTER_MINUTES = 60;
const BATCH_LIMIT = 50;

interface StuckTxn {
  ref: string;
  invoice_id: number;
  created_at: string;
}

/** 'YYYY-MM-DD HH:MM:SS' (giờ VN lưu trong DB) → 'yyyyMMddHHmmss' cho vnp_TransactionDate */
export function vnWallToVnpDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
}

async function markFailed(ref: string): Promise<void> {
  await db
    .prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'")
    .run(ref);
}

async function reconcileOne(txn: StuckTxn): Promise<void> {
  const inv = (await db.prepare('SELECT id, student_id FROM invoices WHERE id = ?').get(txn.invoice_id)) as
    | { id: number; student_id: number }
    | undefined;
  if (!inv) {
    await markFailed(txn.ref); // hóa đơn đã mất → đơn treo vô nghĩa
    return;
  }
  const student = (await db.prepare('SELECT center_id FROM students WHERE id = ?').get(inv.student_id)) as
    | { center_id: number | null }
    | undefined;
  const centerId = student?.center_id ?? 0;
  const s = await getCenterSettings(centerId, ['pay_vnp_tmncode', 'pay_vnp_hashsecret', 'pay_vnp_enabled']);
  const tmnCode = s.get('pay_vnp_tmncode') || '';
  const hashSecret = s.get('pay_vnp_hashsecret') || '';
  // Trung tâm chưa cấu hình VNPay → không động vào tiền, để pending cho người kiểm tra tay
  if (s.get('pay_vnp_enabled') !== '1' || !tmnCode || !hashSecret) {
    log.warn('Bỏ qua đối soát: trung tâm chưa cấu hình VNPay', { ref: txn.ref, centerId });
    return;
  }
  const qd = await queryVnpayTransaction(
    { tmnCode, hashSecret, returnUrl: '' },
    { txnRef: txn.ref, orderInfo: `Doi soat HD${txn.invoice_id}`, transactionDate: vnWallToVnpDate(txn.created_at) }
  );
  if (!qd.ok) {
    await markFailed(txn.ref);
    await sendAlert('Đối soát VNPay thất bại', `Không querydr được đơn ${txn.ref}: ${qd.error}`);
    return;
  }
  const r = await reconcileVnpayTxn(qd.params);
  log.info('Đối soát VNPay xong', { ref: txn.ref, kind: r.kind });
}

async function reconcileOnce(): Promise<void> {
  const rows = (await db
    .prepare(
      `SELECT ref, invoice_id, created_at FROM payment_txns
       WHERE status = 'pending'
         AND created_at < to_char(NOW() - INTERVAL '${STUCK_AFTER_MINUTES} minutes', 'YYYY-MM-DD HH24:MI:SS')
       ORDER BY created_at ASC
       LIMIT ${BATCH_LIMIT}`
    )
    .all()) as StuckTxn[];
  if (rows.length === 0) return;
  log.info(`Đối soát ${rows.length} đơn VNPay treo`);
  for (const txn of rows) {
    try {
      await reconcileOne(txn);
    } catch (err) {
      log.error('Lỗi đối soát đơn VNPay', { ref: txn.ref, error: formatError(err) });
    }
  }
}

let reconcileTask: ReturnType<typeof cron.schedule> | null = null;

export function startVnpayReconcileScheduler(): void {
  if (reconcileTask) return;
  reconcileTask = cron.schedule(
    '*/15 * * * *',
    () => {
      // Advisory lock: 2 worker PM2 chỉ 1 chạy vòng đối soát
      void withAdvisoryLock('educenter-vnpay-reconcile', reconcileOnce).then(
        (outcome) => {
          if (outcome.status === 'error') {
            log.error('Vòng đối soát VNPay lỗi', { error: String(outcome.error) });
          }
        },
        (err) => log.error('Vòng đối soát VNPay lỗi không bắt được', { error: String(err) })
      );
    },
    { timezone: VN_TZ }
  );
  log.info('Đã lên lịch đối soát VNPay treo mỗi 15 phút (Asia/Ho_Chi_Minh)');
}

export function stopVnpayReconcileScheduler(): void {
  void reconcileTask?.stop();
  reconcileTask = null;
}
