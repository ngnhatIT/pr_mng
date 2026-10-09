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
    | 'invalid_invoice_amount';
  detail: string;
  invoice_id?: number;
  payment_id?: number;
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
              CASE WHEN i.id IS NULL THEN 1 ELSE 0 END AS is_orphan
       FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE i.id IS NULL OR p.amount <= 0`
    )
    .all()) as { id: number; invoice_id: number; amount: number; is_orphan: number }[];
  for (const p of badPayments) {
    if (p.is_orphan) {
      issues.push({
        code: 'orphan_payment',
        detail: `Payment #${p.id} trỏ tới hóa đơn không tồn tại (#${p.invoice_id})`,
        payment_id: p.id,
      });
    }
    if (p.amount <= 0) {
      issues.push({
        code: 'invalid_payment_amount',
        detail: `Payment #${p.id}: số tiền không hợp lệ (${p.amount})`,
        payment_id: p.id,
      });
    }
  }

  return issues;
}
