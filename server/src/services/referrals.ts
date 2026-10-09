import { db, getCenterSetting, recalcInvoiceStatus, confirmedPaid } from '../db';
import { logger } from '../shared/logger';

const log = logger.scope('referrals');

/** Sinh mã giới thiệu: 'GT' + base36 (ngắn, dễ đọc) */
export function genReferralCode(): string {
  const part = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
  return `GT${part.padEnd(6, 'X')}`;
}

/** Đảm bảo phụ huynh có referral_code, trả về mã */
export function ensureParentReferralCode(parentId: number): string {
  const row = db.prepare('SELECT referral_code FROM parents WHERE id = ?').get(parentId) as
    { referral_code: string | null } | undefined;
  if (row?.referral_code) return row.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = genReferralCode();
    try {
      db.prepare('UPDATE parents SET referral_code = ? WHERE id = ?').run(code, parentId);
      return code;
    } catch {
      /* trùng mã — thử lại */
    }
  }
  const fallback = `GT${parentId}${Date.now().toString(36).toUpperCase()}`;
  db.prepare('UPDATE parents SET referral_code = ? WHERE id = ?').run(fallback, parentId);
  return fallback;
}

/**
 * Gọi sau khi một hóa đơn chuyển sang 'paid'.
 * Nếu đây là hóa đơn ĐẦU TIÊN học viên thanh toán đủ VÀ học viên được giới thiệu
 * (referrals.status='pending') → thưởng credits cho cả người giới thiệu và người được giới thiệu.
 */
export function afterInvoicePaid(invoiceId: number): void {
  try {
    const inv = db.prepare('SELECT id, student_id, status FROM invoices WHERE id = ?').get(invoiceId) as
      { id: number; student_id: number; status: string } | undefined;
    if (!inv || inv.status !== 'paid') return;

    // Chỉ thưởng cho hóa đơn đầu tiên thanh toán đủ của học viên
    const otherPaid = (
      db
        .prepare("SELECT COUNT(*) as c FROM invoices WHERE student_id = ? AND status = 'paid' AND id != ?")
        .get(inv.student_id, invoiceId) as { c: number }
    ).c;
    if (otherPaid > 0) return;

    const student = db
      .prepare('SELECT id, center_id, phone FROM students WHERE id = ?')
      .get(inv.student_id) as { id: number; center_id: number | null; phone: string | null } | undefined;
    if (!student) return;

    // Tìm referral đang chờ: khớp student_id, hoặc khớp SĐT (khi đăng ký trial/lead bằng SĐT trước)
    let ref = db
      .prepare(
        "SELECT * FROM referrals WHERE referred_student_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1"
      )
      .get(student.id) as { id: number; referrer_parent_id: number } | undefined;
    if (!ref && student.phone) {
      const byPhone = db
        .prepare(
          "SELECT * FROM referrals WHERE referred_phone = ? AND status = 'pending' ORDER BY id ASC LIMIT 1"
        )
        .get(student.phone) as { id: number; referrer_parent_id: number } | undefined;
      if (byPhone) {
        db.prepare('UPDATE referrals SET referred_student_id = ? WHERE id = ?').run(student.id, byPhone.id);
        ref = byPhone;
      }
    }
    if (!ref) return;

    const centerId = student.center_id || 0;
    const amtReferrer = Math.max(
      0,
      Number(getCenterSetting(centerId, 'referral_reward_referrer', '200000')) || 0
    );
    const amtReferred = Math.max(
      0,
      Number(getCenterSetting(centerId, 'referral_reward_referred', '200000')) || 0
    );

    // Tìm parent của học viên được giới thiệu (để nhận credits phía người được giới thiệu)
    const childParent = db
      .prepare('SELECT parent_id FROM parent_students WHERE student_id = ? ORDER BY parent_id ASC LIMIT 1')
      .get(student.id) as { parent_id: number } | undefined;

    const tx = db.transaction(() => {
      const addCredit = db.prepare('INSERT INTO credits (parent_id, amount, reason) VALUES (?, ?, ?)');
      if (amtReferrer > 0) {
        addCredit.run(
          ref!.referrer_parent_id,
          amtReferrer,
          `Thưởng giới thiệu học viên mới (HD${invoiceId})`
        );
      }
      if (amtReferred > 0 && childParent) {
        addCredit.run(childParent.parent_id, amtReferred, `Ưu đãi học viên được giới thiệu (HD${invoiceId})`);
      }
      db.prepare("UPDATE referrals SET status = 'rewarded' WHERE id = ?").run(ref!.id);
    });
    tx();
    log.info(`Đã thưởng credits cho referral #${ref.id} (hóa đơn HD${invoiceId})`);
  } catch (err) {
    log.error('Lỗi afterInvoicePaid', { error: String(err) });
  }
}

/**
 * Áp dụng credits của phụ huynh để trừ tiền hóa đơn.
 * Trả về số tiền đã áp dụng. Ném Error nếu không hợp lệ.
 */
export function applyCreditToInvoice(
  invoiceId: number,
  creditId: number
): { applied: number; status: string } {
  const inv = db.prepare('SELECT id, student_id, amount FROM invoices WHERE id = ?').get(invoiceId) as
    { id: number; student_id: number; amount: number } | undefined;
  if (!inv) throw new Error('Không tìm thấy hóa đơn');

  const credit = db.prepare('SELECT * FROM credits WHERE id = ?').get(creditId) as
    { id: number; parent_id: number; amount: number; used_amount: number } | undefined;
  if (!credit) throw new Error('Không tìm thấy credits');

  // Credits phải thuộc về phụ huynh đã liên kết với học viên của hóa đơn
  const owner = db
    .prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
    .get(credit.parent_id, inv.student_id);
  if (!owner) throw new Error('Credits này không thuộc phụ huynh của học viên');

  const available = credit.amount - credit.used_amount;
  if (available <= 0) throw new Error('Credits đã dùng hết');

  const remaining = inv.amount - confirmedPaid(invoiceId);
  if (remaining <= 0.01) throw new Error('Hóa đơn đã thanh toán đủ');

  const applied = Math.min(available, remaining);

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'credit', ?, 'confirmed')"
    ).run(invoiceId, applied, `Áp dụng credits #${creditId}`);
    db.prepare('UPDATE credits SET used_amount = used_amount + ? WHERE id = ?').run(applied, creditId);
  });
  tx();

  const status = recalcInvoiceStatus(invoiceId);
  if (status === 'paid') afterInvoicePaid(invoiceId);
  return { applied, status };
}
