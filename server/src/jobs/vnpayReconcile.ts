import cron from 'node-cron';
import { db, getCenterSettings } from '../db';
import { queryVnpayTransaction } from '../services/vnpay';
import { reconcileVnpayTxn } from '../modules/payments/payments.service';
import { sweepReferralRewards } from '../modules/referrals/rewards.service';
import { withAdvisoryLock } from '../shared/advisoryLock';
import { sendAlert } from '../shared/alert';
import { logger } from '../shared/logger';
import { formatError } from '../shared/errorFormat';

/**
 * G6: Đối soát đơn VNPay treo.
 * Đơn thanh toán có vnp_ExpireDate = tạo + 30 phút (VNPay không cho trả muộn).
 * Cron chạy mỗi 15 phút, tìm payment_txns còn 'pending' quá 60 phút
 * (30 phút hết hạn + 30 phút grace cho IPN/return về trễ) rồi gọi querydr:
 * - TransactionStatus '00' → confirmed qua đúng đường confirmVnpayTxn (không duplicate logic tiền)
 * - VNPay báo thất bại dứt khoát (status khác '00'/'01', hoặc mã 91 = không có giao dịch) → failed
 * - DATA-13: querydr lỗi tạm thời (mạng/bảo trì/chữ ký...) hoặc VNPay còn xử lý ('01') → GIỮ pending,
 *   tăng query_attempts, thử lại vòng sau; chỉ failed + alert sau MAX_ATTEMPTS lần hoặc quá MAX_AGE_HOURS.
 *   (IPN về trễ vẫn ghi nhận được — confirmVnpayTxn cũng nhận txn 'failed' nếu VNPay báo thành công.)
 * Thêm REF-2: thưởng bù referral bị lỡ (sweepReferralRewards) trong cùng vòng.
 */

const log = logger.scope('vnpay-reconcile');
const VN_TZ = 'Asia/Ho_Chi_Minh';
const STUCK_AFTER_MINUTES = 60;
const MAX_ATTEMPTS = 8; // ~2 giờ với chu kỳ 15 phút
const MAX_AGE_HOURS = 24;
const BATCH_LIMIT = 50;

interface StuckTxn {
  ref: string;
  invoice_id: number;
  created_at: string;
  vnp_create_date: string | null;
  query_attempts: number;
  too_old: boolean;
}

/** 'YYYY-MM-DD HH:MM:SS' (giờ VN lưu trong DB) → 'yyyyMMddHHmmss' cho vnp_TransactionDate */
export function vnWallToVnpDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
}

async function markFailed(ref: string): Promise<void> {
  await db.prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ? AND status = 'pending'").run(ref);
}

/**
 * Phân loại kết quả querydr (thuần — có unit test).
 * 'confirm' = VNPay báo thành công; 'fail' = thất bại dứt khoát; 'retry' = chưa kết luận được.
 */
export function classifyQuerydr(qd: {
  ok: boolean;
  responseCode: string;
  transactionStatus: string;
}): 'confirm' | 'fail' | 'retry' {
  if (!qd.ok) return 'retry';
  if (qd.responseCode === '91') return 'fail'; // VNPay không có giao dịch: phụ huynh chưa thanh toán, đơn đã hết hạn
  if (qd.responseCode !== '00') return 'retry';
  if (qd.transactionStatus === '00') return 'confirm';
  if (qd.transactionStatus === '01' || qd.transactionStatus === '') return 'retry';
  return 'fail';
}

/** Lỗi tạm thời: tăng số lần thử; quá ngưỡng/lâu quá thì failed + alert để xử lý tay. */
async function retryLater(txn: StuckTxn, why: string): Promise<void> {
  const attempts = txn.query_attempts + 1;
  await db.prepare('UPDATE payment_txns SET query_attempts = ? WHERE ref = ?').run(attempts, txn.ref);
  if (attempts >= MAX_ATTEMPTS || txn.too_old) {
    await markFailed(txn.ref);
    await sendAlert(
      'Đối soát VNPay thất bại',
      `Đơn ${txn.ref} sau ${attempts} lần querydr: ${why} — kiểm tra tay`
    );
  } else {
    log.warn('querydr chưa kết luận, thử lại vòng sau', { ref: txn.ref, attempts, why });
  }
}

async function reconcileOne(txn: StuckTxn): Promise<void> {
  const inv = (await db.prepare('SELECT id, student_id FROM invoices WHERE id = ?').get(txn.invoice_id)) as
    { id: number; student_id: number } | undefined;
  if (!inv) {
    await markFailed(txn.ref); // hóa đơn đã mất → đơn treo vô nghĩa
    return;
  }
  const student = (await db.prepare('SELECT center_id FROM students WHERE id = ?').get(inv.student_id)) as
    { center_id: number | null } | undefined;
  const centerId = student?.center_id ?? 0;
  const s = await getCenterSettings(centerId, ['pay_vnp_tmncode', 'pay_vnp_hashsecret', 'pay_vnp_enabled']);
  const tmnCode = s.get('pay_vnp_tmncode') || '';
  const hashSecret = s.get('pay_vnp_hashsecret') || '';
  // Trung tâm chưa cấu hình VNPay → không querydr được; vẫn đếm lần thử để không treo mãi
  if (s.get('pay_vnp_enabled') !== '1' || !tmnCode || !hashSecret) {
    await retryLater(txn, 'trung tâm chưa cấu hình VNPay');
    return;
  }
  const qd = await queryVnpayTransaction(
    { tmnCode, hashSecret, returnUrl: '' },
    {
      txnRef: txn.ref,
      orderInfo: `Doi soat HD${txn.invoice_id}`,
      // PAY-4: đúng vnp_CreateDate đã gửi trong URL thanh toán (txn cũ chưa lưu thì suy từ created_at)
      transactionDate: txn.vnp_create_date || vnWallToVnpDate(txn.created_at),
    }
  );
  const verdict = classifyQuerydr(qd);
  if (verdict === 'retry') {
    await retryLater(
      txn,
      qd.error || `ResponseCode ${qd.responseCode}, TransactionStatus ${qd.transactionStatus}`
    );
    return;
  }
  if (verdict === 'fail') {
    await markFailed(txn.ref);
    log.info('Đối soát VNPay: giao dịch thất bại', {
      ref: txn.ref,
      rc: qd.responseCode,
      ts: qd.transactionStatus,
    });
    return;
  }
  const r = await reconcileVnpayTxn(qd.params);
  log.info('Đối soát VNPay xong', { ref: txn.ref, kind: r.kind });
}

async function reconcileOnce(): Promise<void> {
  const rows = (await db
    .prepare(
      `SELECT ref, invoice_id, created_at, vnp_create_date, query_attempts,
         created_at < to_char(NOW() - INTERVAL '${MAX_AGE_HOURS} hours', 'YYYY-MM-DD HH24:MI:SS') AS too_old
       FROM payment_txns
       WHERE status = 'pending'
         AND created_at < to_char(NOW() - INTERVAL '${STUCK_AFTER_MINUTES} minutes', 'YYYY-MM-DD HH24:MI:SS')
       ORDER BY created_at ASC
       LIMIT ${BATCH_LIMIT}`
    )
    .all()) as StuckTxn[];
  if (rows.length > 0) log.info(`Đối soát ${rows.length} đơn VNPay treo`);
  for (const txn of rows) {
    try {
      await reconcileOne(txn);
    } catch (err) {
      log.error('Lỗi đối soát đơn VNPay', { ref: txn.ref, error: formatError(err) });
    }
  }
  try {
    const n = await sweepReferralRewards();
    if (n > 0) log.info(`Thưởng bù ${n} referral bị lỡ`);
  } catch (err) {
    log.error('Lỗi thưởng bù referral', { error: formatError(err) });
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
