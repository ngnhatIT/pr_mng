import { randomBytes } from 'crypto';
import { db, getCenterSetting, recalcInvoiceStatus } from '../db';
import { AppError } from '../shared/errors';
import { logger } from '../shared/logger';
import { audit } from '../shared/audit';
import { withAdvisoryLock } from '../shared/advisoryLock';

const log = logger.scope('referrals');

/** Sinh mã giới thiệu: 'GT' + base36 (ngắn, dễ đọc). Dùng CSPRNG vì mã gắn với tiền. */
export async function genReferralCode(): Promise<string> {
  const bytes = randomBytes(4); // 32 bit
  const part = BigInt(`0x${bytes.toString('hex')}`)
    .toString(36)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')
    .padStart(6, 'X')
    .slice(-6);
  return `GT${part}`;
}

/** Đảm bảo phụ huynh có referral_code, trả về mã */
export async function ensureParentReferralCode(parentId: number): Promise<string> {
  const row = (await db.prepare('SELECT referral_code FROM parents WHERE id = ?').get(parentId)) as
    { referral_code: string | null } | undefined;
  if (row?.referral_code) return row.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = await genReferralCode();
    try {
      await db.prepare('UPDATE parents SET referral_code = ? WHERE id = ?').run(code, parentId);
      return code;
    } catch {
      /* trùng mã — thử lại */
    }
  }
  const fallback = `GT${parentId}${Date.now().toString(36).toUpperCase()}`;
  await db.prepare('UPDATE parents SET referral_code = ? WHERE id = ?').run(fallback, parentId);
  return fallback;
}

/**
 * Gọi sau khi một hóa đơn chuyển sang 'paid'.
 * Nếu đây là hóa đơn ĐẦU TIÊN học viên thanh toán đủ VÀ học viên được giới thiệu
 * (referrals.status='pending') → thưởng credits cho cả người giới thiệu và người được giới thiệu.
 */
export async function afterInvoicePaid(invoiceId: number): Promise<void> {
  try {
    const inv = (await db
      .prepare('SELECT id, student_id, status FROM invoices WHERE id = ?')
      .get(invoiceId)) as { id: number; student_id: number; status: string } | undefined;
    if (!inv || inv.status !== 'paid') return;

    // Advisory lock theo student: 2 hóa đơn cùng học viên paid đồng thời
    // không thưởng 2 lần (mỗi luồng có thể claim 1 referral row khác nhau).
    // Nếu locked → retry 1 lần sau 2s (tránh mất reward khi lock holder xử lý HD khác trước).
    let outcome = await withAdvisoryLock(`referral-reward:${inv.student_id}`, async () => {
      await doAfterInvoicePaid(inv);
    });
    if (outcome.status === 'locked') {
      await new Promise((r) => setTimeout(r, 2000));
      outcome = await withAdvisoryLock(`referral-reward:${inv.student_id}`, async () => {
        await doAfterInvoicePaid(inv);
      });
    }
    if (outcome.status !== 'done') {
      logger.warn('afterInvoicePaid không hoàn tất', { invoiceId, status: outcome.status });
    }
  } catch (err) {
    logger.error('afterInvoicePaid thất bại', { invoiceId, error: String(err) });
  }
}

async function doAfterInvoicePaid(inv: { id: number; student_id: number; status: string }): Promise<void> {

    // Chỉ thưởng cho hóa đơn đầu tiên thanh toán đủ của học viên
    const otherPaid = (
      (await db
        .prepare("SELECT COUNT(*) as c FROM invoices WHERE student_id = ? AND status = 'paid' AND id != ?")
        .get(inv.student_id, inv.id)) as { c: number }
    ).c;
    if (otherPaid > 0) return;

    // Chống thưởng trùng: học viên chỉ được thưởng 1 lần duy nhất (dù có nhiều referral pending)
    const alreadyRewarded = (await db
      .prepare("SELECT 1 FROM referrals WHERE referred_student_id = ? AND status = 'rewarded' LIMIT 1")
      .get(inv.student_id)) as { '1'?: number } | undefined;
    if (alreadyRewarded) return;

    const student = (await db
      .prepare('SELECT id, center_id, phone FROM students WHERE id = ?')
      .get(inv.student_id)) as { id: number; center_id: number | null; phone: string | null } | undefined;
    if (!student) return;

    // Tìm referral đang chờ: khớp student_id, hoặc khớp SĐT (khi đăng ký trial/lead bằng SĐT trước)
    let ref = (await db
      .prepare(
        "SELECT * FROM referrals WHERE referred_student_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1"
      )
      .get(student.id)) as { id: number; referrer_parent_id: number } | undefined;
    if (!ref && student.phone) {
      const byPhone = (await db
        .prepare(
          "SELECT * FROM referrals WHERE referred_phone = ? AND status = 'pending' ORDER BY id ASC LIMIT 1"
        )
        .get(student.phone)) as { id: number; referrer_parent_id: number } | undefined;
      if (byPhone) {
        await db
          .prepare('UPDATE referrals SET referred_student_id = ? WHERE id = ?')
          .run(student.id, byPhone.id);
        ref = byPhone;
      }
    }
    if (!ref) return;

    const centerId = student.center_id ?? null;
    // Học viên legacy chưa có center → dùng default reward, credit center_id = null
    const amtReferrer = Math.max(
      0,
      Number(centerId !== null ? await getCenterSetting(centerId, 'referral_reward_referrer', '200000') : '200000') || 0
    );
    const amtReferred = Math.max(
      0,
      Number(centerId !== null ? await getCenterSetting(centerId, 'referral_reward_referred', '200000') : '200000') || 0
    );

    // Tìm parent của học viên được giới thiệu (để nhận credits phía người được giới thiệu)
    const childParent = (await db
      .prepare('SELECT parent_id FROM parent_students WHERE student_id = ? ORDER BY parent_id ASC LIMIT 1')
      .get(student.id)) as { parent_id: number } | undefined;

    const refId = ref.id;
    const referrerParentId = ref.referrer_parent_id;
    const rewarded = await db.transaction(async (tx) => {
      // Chống double-reward đồng thời: chỉ 1 bên giành được chuyển trạng thái
      const claimed = await tx
        .prepare("UPDATE referrals SET status = 'rewarded' WHERE id = ? AND status = 'pending'")
        .run(refId);
      if ((claimed.changes ?? 0) !== 1) return false; // đã có luồng khác thưởng rồi
      const addCredit = await tx.prepare(
        'INSERT INTO credits (parent_id, amount, reason, center_id) VALUES (?, ?, ?, ?)'
      );
      if (amtReferrer > 0) {
        await addCredit.run(
          referrerParentId,
          Math.round(amtReferrer),
          `Thưởng giới thiệu học viên mới (HD${inv.id})`,
          centerId
        );
      }
      if (amtReferred > 0 && childParent) {
        await addCredit.run(
          childParent.parent_id,
          Math.round(amtReferred),
          `Ưu đãi học viên được giới thiệu (HD${inv.id})`,
          centerId
        );
      }
      return true;
    });
    if (rewarded) log.info(`Đã thưởng credits cho referral #${ref.id} (hóa đơn HD${inv.id})`);
}

/**
 * Áp dụng credits của phụ huynh để trừ tiền hóa đơn.
 * Trả về số tiền đã áp dụng. Ném Error nếu không hợp lệ.
 */
export async function applyCreditToInvoice(
  invoiceId: number,
  creditId: number
): Promise<{ applied: number; status: string }> {
  const inv = (await db
    .prepare('SELECT id, student_id, amount FROM invoices WHERE id = ?')
    .get(invoiceId)) as { id: number; student_id: number; amount: number } | undefined;
  if (!inv) throw AppError.notFound('Không tìm thấy hóa đơn');

  const credit = (await db.prepare('SELECT * FROM credits WHERE id = ?').get(creditId)) as
    | { id: number; parent_id: number; amount: number; used_amount: number; center_id: number | null }
    | undefined;
  if (!credit) throw AppError.notFound('Không tìm thấy credits');

  // Chặn áp credits chéo trung tâm (kể cả credit legacy center_id NULL — phải gán center trước)
  const studentCenter = (await db
    .prepare('SELECT center_id FROM students WHERE id = ?')
    .get(inv.student_id)) as { center_id: number | null } | undefined;
  if (credit.center_id === null) {
    throw AppError.badRequest('Credits chưa gán trung tâm, vui lòng liên hệ quản trị viên');
  }
  if (studentCenter?.center_id && credit.center_id !== studentCenter.center_id) {
    throw AppError.badRequest('Credits này không áp dụng cho trung tâm của hóa đơn');
  }

  // Credits phải thuộc về phụ huynh đã liên kết với học viên của hóa đơn
  const owner = await db
    .prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
    .get(credit.parent_id, inv.student_id);
  if (!owner) throw AppError.badRequest('Credits này không thuộc phụ huynh của học viên');

  // Toàn bộ tính toán + ghi nhận trong 1 transaction, lock cả hóa đơn và credit
  // (chống 2 request đồng thời cùng áp vượt số nợ).
  const { applied } = await db.transaction(async (tx) => {
    const lockedInv = (await tx
      .prepare('SELECT amount FROM invoices WHERE id = ? FOR UPDATE')
      .get(invoiceId)) as { amount: number } | undefined;
    if (!lockedInv) throw AppError.notFound('Không tìm thấy hóa đơn');
    const lockedCredit = (await tx
      .prepare('SELECT amount, used_amount FROM credits WHERE id = ? FOR UPDATE')
      .get(creditId)) as { amount: number; used_amount: number } | undefined;
    if (!lockedCredit) throw AppError.notFound('Không tìm thấy credits');

    const available = lockedCredit.amount - lockedCredit.used_amount;
    if (available <= 0) throw AppError.badRequest('Credits đã dùng hết');

    const paidRow = (await tx
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(invoiceId)) as { paid: number };
    const remaining = lockedInv.amount - Number(paidRow.paid);
    if (remaining <= 0.01) throw AppError.badRequest('Hóa đơn đã thanh toán đủ');

    const applied = Math.round(Math.min(available, remaining));
    await tx
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'credit', ?, 'confirmed')"
      )
      .run(invoiceId, applied, `Áp dụng credits #${creditId}`);
    // Re-check chống race: nếu payment khác chen vào giữa lúc tính remaining → rollback
    const finalPaid = (await tx
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
      )
      .get(invoiceId)) as { paid: number };
    if (Number(finalPaid.paid) > lockedInv.amount + 0.01) {
      throw AppError.conflict('Hóa đơn vừa được thanh toán bởi giao dịch khác, vui lòng thử lại');
    }
    await tx.prepare('UPDATE credits SET used_amount = used_amount + ? WHERE id = ?').run(applied, creditId);
    const newStatus = Number(paidRow.paid) + applied >= lockedInv.amount - 0.01 ? 'paid' : 'partial';
    await tx.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(newStatus, invoiceId);
    return { applied };
  });

  if (applied <= 0) throw AppError.badRequest('Không áp dụng được credits');
  const status = await recalcInvoiceStatus(invoiceId);
  if (status === 'paid') await afterInvoicePaid(invoiceId);
  // Audit: credits là tiền thật
  await audit({
    centerId: null,
    action: 'apply_credit',
    entity: 'credits',
    entityId: creditId,
    summary: `Áp ${applied.toLocaleString('vi-VN')}đ credits vào HD${inv.id}`,
    meta: { invoiceId, creditId, applied },
  });
  return { applied, status };
}
