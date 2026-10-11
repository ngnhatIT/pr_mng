import type { Db } from './connection';

/**
 * Kiểm tra đối soát tài chính — "bộ phận kiểm toán" chạy định kỳ.
 *
 * Phát hiện sớm dữ liệu lệch mà FK/CHECK không bắt được:
 * - Trạng thái hóa đơn lệch với số tiền đã thu duyệt (status drift)
 * - Thu vượt số tiền hóa đơn (overpaid)
 * - Payment mồ côi (DB cũ trước thời FK)
 * - Số tiền bất thường (âm / bằng 0)
 *
 * Dùng trong: health check sâu, cron đối soát hằng ngày, CI.
 * Chỉ ĐỌC — không bao giờ tự sửa dữ liệu.
 */

export interface ConsistencyIssue {
  code:
    | 'invoice_status_drift'
    | 'overpaid_invoice'
    | 'orphan_payment'
    | 'invalid_payment_amount'
    | 'invalid_invoice_amount'
    | 'user_without_center'
    | 'credit_payment_unlinked'
    | 'role_cross_center';
  detail: string;
  invoice_id?: number;
  payment_id?: number;
  user_id?: number;
}

export async function checkFinancialConsistency(db: Db): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  // 1. Trạng thái hóa đơn phải khớp với công thức: paid>=amount → paid, >0 → partial, còn lại unpaid
  const drifted = (await db
    .prepare(
      `SELECT i.id, i.amount, i.status,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'confirmed'), 0) AS paid
       FROM invoices i`
    )
    .all()) as { id: number; amount: number; status: string; paid: number }[];
  for (const inv of drifted) {
    const expected = inv.paid >= inv.amount - 0.01 ? 'paid' : inv.paid > 0 ? 'partial' : 'unpaid';
    if (inv.status !== expected) {
      issues.push({
        code: 'invoice_status_drift',
        detail: `Hóa đơn #${inv.id}: status='${inv.status}' nhưng tính lại phải là '${expected}' (đã thu ${inv.paid}/${inv.amount})`,
        invoice_id: inv.id,
      });
    }
    // 2. Thu vượt
    if (inv.paid > inv.amount + 0.01) {
      issues.push({
        code: 'overpaid_invoice',
        detail: `Hóa đơn #${inv.id}: đã thu ${inv.paid} vượt tổng ${inv.amount}`,
        invoice_id: inv.id,
      });
    }
    // 5. Hóa đơn số tiền âm
    if (inv.amount < 0) {
      issues.push({
        code: 'invalid_invoice_amount',
        detail: `Hóa đơn #${inv.id}: số tiền âm (${inv.amount})`,
        invoice_id: inv.id,
      });
    }
  }

  // 3+4. Payment mồ côi / số tiền bất thường
  const badPayments = (await db
    .prepare(
      `SELECT p.id, p.invoice_id, p.amount,
              CASE WHEN i.id IS NULL THEN 1 ELSE 0 END AS is_orphan,
              p.method
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE i.id IS NULL OR (p.amount <= 0 AND p.method != 'refund')`
    )
    .all()) as { id: number; invoice_id: number; amount: number; is_orphan: number; method: string }[];
  for (const p of badPayments) {
    if (p.is_orphan) {
      issues.push({
        code: 'orphan_payment',
        detail: `Payment #${p.id} trỏ tới hóa đơn không tồn tại (#${p.invoice_id})`,
        payment_id: p.id,
      });
    }
    // Refund hợp lệ có amount âm — không flag
    if (p.amount <= 0 && p.method !== 'refund') {
      issues.push({
        code: 'invalid_payment_amount',
        detail: `Payment #${p.id}: số tiền không hợp lệ (${p.amount})`,
        payment_id: p.id,
      });
    }
  }

  // 6. OPS-1: user không phải superadmin mà center_id NULL (dòng cũ trước v22; chk_users_center chỉ NOT VALID
  //    cho tới khi vận hành sửa xong và VALIDATE — xem docs/DEPLOYMENT.md "Nâng cấp phiên bản").
  const noCenter = (await db
    .prepare("SELECT id, username, role FROM users WHERE role <> 'superadmin' AND center_id IS NULL")
    .all()) as { id: number; username: string; role: string }[];
  for (const u of noCenter) {
    issues.push({
      code: 'user_without_center',
      detail: `User #${u.id} (${u.username}, ${u.role}) chưa gán trung tâm — đăng nhập sẽ bị 403 NO_CENTER`,
      user_id: u.id,
    });
  }

  // 7. J-A5: payment 'credit' đã duyệt nhưng không gắn credit_id (note lạ trước S-1, v23 cố tình không nối)
  //    -> hoàn tiền sẽ không trả lại credit; kế toán xem tay.
  const unlinked = (await db
    .prepare(
      "SELECT id, invoice_id, note FROM payments WHERE method = 'credit' AND status = 'confirmed' AND credit_id IS NULL"
    )
    .all()) as { id: number; invoice_id: number; note: string | null }[];
  for (const p of unlinked) {
    issues.push({
      code: 'credit_payment_unlinked',
      detail: `Payment #${p.id} (HĐ #${p.invoice_id}) trừ bằng credit nhưng không gắn credit nào (note: ${p.note ?? ''})`,
      payment_id: p.id,
      invoice_id: p.invoice_id,
    });
  }

  // 8. N6-1: custom role của trung tâm X gán cho user trung tâm khác (gán trước khi có chặn) -> quyền lọt sang tenant khác
  const crossRole = (await db
    .prepare(
      `SELECT ur.user_id, ur.role_id, r.center_id AS role_center, u.center_id AS user_center
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
       WHERE r.center_id IS NOT NULL AND u.center_id IS DISTINCT FROM r.center_id`
    )
    .all()) as { user_id: number; role_id: number; role_center: number; user_center: number | null }[];
  for (const x of crossRole) {
    issues.push({
      code: 'role_cross_center',
      detail: `User #${x.user_id} (trung tâm ${x.user_center ?? '-'}) có role #${x.role_id} của trung tâm ${x.role_center} — gỡ bằng DELETE /roles/assign`,
      user_id: x.user_id,
    });
  }

  return issues;
}
