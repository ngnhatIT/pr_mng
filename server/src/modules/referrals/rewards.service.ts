import { randomBytes } from 'crypto';
import { db, getCenterSetting, type Tx } from '../../db';
import { AppError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { audit } from '../../shared/audit';
import { withAdvisoryLock } from '../../shared/advisoryLock';
import { sendAlert } from '../../shared/alert';
import { normalizePhone } from '../../services/zalo';

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

/** Lý do credits thưởng (hiển thị). Thu hồi theo credits.source_invoice_id (v23), không theo chuỗi này. */
const reasonReferrer = (invoiceId: number): string => `Thưởng giới thiệu học viên mới (HD${invoiceId})`;
const reasonReferred = (invoiceId: number): string => `Ưu đãi học viên được giới thiệu (HD${invoiceId})`;

/**
 * REF-1: tạo referral 'pending' gắn trung tâm (từ form đăng ký học thử công khai).
 * Bỏ qua SĐT đã là học viên/phụ huynh của trung tâm (không phải khách mới — chặn "nhận vơ")
 * và SĐT đã có referral pending của cùng người giới thiệu. Trả về true nếu đã tạo.
 */
export async function createReferral(
  centerId: number,
  referrerParentId: number,
  phone: string
): Promise<boolean> {
  const exists = await db
    .prepare(
      `SELECT 1 FROM students WHERE center_id = ? AND phone = ?
       UNION ALL SELECT 1 FROM parents WHERE center_id = ? AND phone = ?
       UNION ALL SELECT 1 FROM referrals
         WHERE center_id = ? AND referrer_parent_id = ? AND referred_phone = ? AND status = 'pending'
       LIMIT 1`
    )
    .get(centerId, phone, centerId, phone, centerId, referrerParentId, phone);
  if (exists) return false;
  await db
    .prepare(
      "INSERT INTO referrals (referrer_parent_id, referred_phone, referred_student_id, status, center_id) VALUES (?, ?, NULL, 'pending', ?)"
    )
    .run(referrerParentId, phone, centerId);
  return true;
}

/**
 * Gọi sau khi một hóa đơn chuyển sang 'paid'.
 * Học viên được giới thiệu (referral 'pending' cùng trung tâm) và chưa từng được thưởng →
 * thưởng credits cho cả người giới thiệu và người được giới thiệu.
 * REF-2: không bao giờ mất thưởng — lock bận/lỗi/crash sau commit thì sweepReferralRewards
 * (cron 15 phút) thưởng bù, idempotent nhờ claim status 'pending' -> 'rewarded'.
 */
export async function afterInvoicePaid(invoiceId: number): Promise<void> {
  try {
    const inv = (await db
      .prepare('SELECT id, student_id, status, amount FROM invoices WHERE id = ?')
      .get(invoiceId)) as { id: number; student_id: number; status: string; amount: number } | undefined;
    // amount 0 = hóa đơn đã hoàn hết (PAY-2) -> không đủ điều kiện thưởng
    if (!inv || inv.status !== 'paid' || !(Number(inv.amount) > 0)) return;
    // Advisory lock theo student: 2 hóa đơn cùng học viên paid đồng thời không thưởng 2 lần
    const outcome = await withAdvisoryLock(`referral-reward:${inv.student_id}`, () =>
      doAfterInvoicePaid(inv)
    );
    if (outcome.status !== 'done') {
      log.warn('afterInvoicePaid chưa hoàn tất — cron sẽ thưởng bù', {
        invoiceId,
        status: outcome.status,
        error: outcome.error ? String(outcome.error) : undefined,
      });
    }
  } catch (err) {
    log.error('afterInvoicePaid thất bại — cron sẽ thưởng bù', { invoiceId, error: String(err) });
  }
}

async function doAfterInvoicePaid(inv: { id: number; student_id: number }): Promise<void> {
  const student = (await db
    .prepare('SELECT id, center_id, phone, created_at FROM students WHERE id = ?')
    .get(inv.student_id)) as
    { id: number; center_id: number | null; phone: string | null; created_at: string } | undefined;
  // REF-1: referral gắn trung tâm — học viên legacy chưa có center không khớp được referral nào
  if (!student || student.center_id === null) return;
  const centerId = student.center_id;

  // Chống thưởng trùng: học viên chỉ được thưởng 1 lần duy nhất (dù có nhiều referral pending)
  const alreadyRewarded = await db
    .prepare("SELECT 1 FROM referrals WHERE referred_student_id = ? AND status = 'rewarded' LIMIT 1")
    .get(student.id);
  if (alreadyRewarded) return;

  // Tìm referral đang chờ CÙNG TRUNG TÂM: khớp student_id, hoặc khớp SĐT với referral tạo TRƯỚC
  // khi học viên nhập học (đăng ký học thử bằng SĐT trước) — chặn nhận vơ học viên cũ / tenant khác
  let ref = (await db
    .prepare(
      "SELECT id, referrer_parent_id FROM referrals WHERE referred_student_id = ? AND center_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1"
    )
    .get(student.id, centerId)) as { id: number; referrer_parent_id: number } | undefined;
  if (!ref && student.phone) {
    const phone = student.phone;
    ref = (await db
      .prepare(
        `SELECT id, referrer_parent_id FROM referrals
         WHERE referred_student_id IS NULL AND center_id = ? AND status = 'pending'
           AND referred_phone IN (?, ?) AND created_at <= ?
         ORDER BY id ASC LIMIT 1`
      )
      .get(centerId, phone, normalizePhone(phone) ?? phone, student.created_at)) as
      { id: number; referrer_parent_id: number } | undefined;
  }
  if (!ref) return;

  const amtReferrer = Math.max(
    0,
    Number(await getCenterSetting(centerId, 'referral_reward_referrer', '200000')) || 0
  );
  const amtReferred = Math.max(
    0,
    Number(await getCenterSetting(centerId, 'referral_reward_referred', '200000')) || 0
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
      .prepare(
        "UPDATE referrals SET status = 'rewarded', referred_student_id = ? WHERE id = ? AND status = 'pending'"
      )
      .run(student.id, refId);
    if ((claimed.changes ?? 0) !== 1) return false; // đã có luồng khác thưởng rồi
    const addCredit = tx.prepare(
      'INSERT INTO credits (parent_id, amount, reason, center_id, source_invoice_id) VALUES (?, ?, ?, ?, ?)'
    );
    if (amtReferrer > 0) {
      await addCredit.run(
        referrerParentId,
        Math.round(amtReferrer),
        reasonReferrer(inv.id),
        centerId,
        inv.id
      );
    }
    if (amtReferred > 0 && childParent) {
      await addCredit.run(
        childParent.parent_id,
        Math.round(amtReferred),
        reasonReferred(inv.id),
        centerId,
        inv.id
      );
    }
    return true;
  });
  if (rewarded) {
    log.info(`Đã thưởng credits cho referral #${refId} (hóa đơn HD${inv.id})`);
    // Audit log: tiền thật được cấp, cần forensic trail
    await audit({
      action: 'referral_reward',
      entity: 'referral',
      entityId: refId,
      centerId,
      summary: `Thưởng giới thiệu cho HD${inv.id}`,
      meta: {
        invoiceId: inv.id,
        referrerAmount: Math.round(amtReferrer),
        referredAmount: Math.round(amtReferred),
      },
    });
  }
}

/**
 * REF-2: thưởng bù các referral còn 'pending' mà học viên đã có hóa đơn paid
 * (lock bận, lỗi, hoặc crash giữa commit và thưởng). Gọi từ cron 15 phút.
 */
export async function sweepReferralRewards(limit = 100): Promise<number> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT ON (s.id) i.id AS invoice_id
       FROM referrals r
       JOIN students s ON s.center_id = r.center_id
         AND (s.id = r.referred_student_id
              OR (r.referred_student_id IS NULL AND s.phone = r.referred_phone AND s.created_at >= r.created_at))
       JOIN invoices i ON i.student_id = s.id AND i.status = 'paid' AND i.amount > 0
       WHERE r.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM referrals x WHERE x.referred_student_id = s.id AND x.status = 'rewarded')
       ORDER BY s.id, i.id
       LIMIT ?`
    )
    .all(limit)) as { invoice_id: number }[];
  for (const r of rows) await afterInvoicePaid(r.invoice_id);
  return rows.length;
}

export interface ReferralRevoke {
  creditIds: number[];
  centerId: number | null;
  voided: number;
  alreadyUsed: number;
}

/**
 * PAY-5/C-2: hóa đơn đã dùng để thưởng giới thiệu bị hoàn hết -> thu hồi credits thưởng của nó.
 * Chạy TRONG transaction hoàn tiền (không còn cửa sổ crash giữa commit và thu hồi). Thu hồi =
 * voided_at + used_amount = amount: mọi chỗ tính "còn lại" (amount - used_amount) thấy 0, và hoàn
 * tiền hóa đơn khác từng tiêu credit này KHÔNG trả lại (bỏ qua credit đã void, xem refundInvoice).
 * Trả null nếu hóa đơn không sinh thưởng. Audit/alert gọi reportReferralRevoke sau commit.
 */
export async function revokeReferralReward(tx: Tx, invoiceId: number): Promise<ReferralRevoke | null> {
  const credits = (await tx
    .prepare(
      'SELECT id, amount, used_amount, center_id FROM credits WHERE source_invoice_id = ? AND voided_at IS NULL FOR UPDATE'
    )
    .all(invoiceId)) as { id: number; amount: number; used_amount: number; center_id: number | null }[];
  if (credits.length === 0) return null;
  await tx
    .prepare(
      "UPDATE credits SET voided_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'), used_amount = amount WHERE source_invoice_id = ? AND voided_at IS NULL"
    )
    .run(invoiceId);
  return {
    creditIds: credits.map((c) => c.id),
    centerId: credits[0].center_id,
    voided: credits.reduce((t, c) => t + Number(c.amount) - Number(c.used_amount), 0),
    alreadyUsed: credits.reduce((t, c) => t + Number(c.used_amount), 0),
  };
}

/** Audit + alert sau khi thu hồi thưởng đã commit (lỗi ở đây không làm hỏng hoàn tiền). */
export async function reportReferralRevoke(invoiceId: number, r: ReferralRevoke): Promise<void> {
  try {
    await audit({
      action: 'referral_revoke',
      entity: 'invoices',
      entityId: invoiceId,
      centerId: r.centerId,
      summary: `Thu hồi thưởng giới thiệu của HD${invoiceId} (hoàn hết): hủy ${r.voided.toLocaleString('vi-VN')}đ credits`,
      meta: { credit_ids: r.creditIds, voided: r.voided, already_used: r.alreadyUsed },
    });
    if (r.alreadyUsed > 0) {
      await sendAlert(
        'Thưởng giới thiệu đã dùng nhưng hóa đơn bị hoàn hết',
        `HD${invoiceId}: ${r.alreadyUsed.toLocaleString('vi-VN')}đ credits thưởng đã được sử dụng — cần xử lý tay`
      );
    }
  } catch (err) {
    log.error('reportReferralRevoke thất bại', { invoiceId, error: String(err) });
  }
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
  const { applied, status } = await db.transaction(async (tx) => {
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
        "INSERT INTO payments (invoice_id, amount, method, note, status, credit_id) VALUES (?, ?, 'credit', ?, 'confirmed', ?)"
      )
      .run(invoiceId, applied, `Áp dụng credits #${creditId}`, creditId);
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
    return { applied, status: newStatus };
  });

  if (applied <= 0) throw AppError.badRequest('Không áp dụng được credits');
  if (status === 'paid') await afterInvoicePaid(invoiceId);
  // Audit: credits là tiền thật
  await audit({
    centerId: studentCenter?.center_id ?? null,
    action: 'apply_credit',
    entity: 'credits',
    entityId: creditId,
    summary: `Áp ${applied.toLocaleString('vi-VN')}đ credits vào HD${inv.id}`,
    meta: { invoiceId, creditId, applied },
  });
  return { applied, status };
}
