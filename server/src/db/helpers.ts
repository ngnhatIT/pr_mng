import { db } from './connection';
import { toISODate, addDays, ourDayOfWeek, parseISODate, ScheduleEntry, ClassRow } from './date-utils';

/**
 * Helper nghiệp vụ dùng chung: settings, sinh buổi học, tính trạng thái hóa đơn.
 * (Về lâu dài nên chuyển vào modules/<domain>/*.service.ts)
 */
export function ensureDemoCenter(): number {
  const row = db.prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1').get() as
    { id: number } | undefined;
  if (row) return row.id;
  const r = db
    .prepare(
      "INSERT INTO centers (name, subdomain, phone, address, plan) VALUES ('Trung tâm Demo', 'demo', '0901234567', 'TP. Hồ Chí Minh', 'premium')"
    )
    .run();
  return Number(r.lastInsertRowid);
}

function backfillCenters(): void {
  const demoId = ensureDemoCenter();
  const tables = [
    'students',
    'teachers',
    'classes',
    'parents',
    'leads',
    'trial_registrations',
    'reviews',
    'leave_requests',
    'grades',
    'homework',
    'rooms',
  ];
  for (const t of tables) {
    try {
      db.prepare(`UPDATE ${t} SET center_id = ? WHERE center_id IS NULL`).run(demoId);
    } catch {
      /* bảng có thể chưa có cột trong trường hợp hiếm — bỏ qua */
    }
  }
  // users: gán center cho tất cả trừ superadmin (giữ NULL để bypass)
  try {
    db.prepare("UPDATE users SET center_id = ? WHERE center_id IS NULL AND role != 'superadmin'").run(demoId);
  } catch {
    /* bỏ qua */
  }

  // Copy cấu hình settings toàn cục (cũ) sang center_settings của trung tâm demo
  try {
    db.prepare(
      'INSERT OR IGNORE INTO center_settings (center_id, key, value) SELECT ?, key, value FROM settings'
    ).run(demoId);
  } catch {
    /* bỏ qua */
  }
}

/** Gán center_id cho dữ liệu cũ (chạy SAU createSchema + migrations, không gọi ở top-level). */
export { backfillCenters };

/* --------------------- Đọc/ghi cấu hình (bảng settings) --------------------- */

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string | null } | undefined;
  if (!row || row.value === null || row.value === undefined) return fallback;
  return row.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

/* --------------------- Cấu hình theo trung tâm --------------------- */

export function getCenterSetting(centerId: number, key: string, fallback = ''): string {
  const row = db
    .prepare('SELECT value FROM center_settings WHERE center_id = ? AND key = ?')
    .get(centerId, key) as { value: string | null } | undefined;
  if (row && row.value !== null && row.value !== undefined) return row.value;
  return getSetting(key, fallback); // fallback về cấu hình toàn cục (tương thích DB cũ)
}

export function setCenterSetting(centerId: number, key: string, value: string): void {
  db.prepare(
    'INSERT INTO center_settings (center_id, key, value) VALUES (?, ?, ?) ON CONFLICT(center_id, key) DO UPDATE SET value = excluded.value'
  ).run(centerId, key, value);
}

/* --------------------- Sinh buổi học từ lịch của lớp --------------------- */

export function generateSessionsForClass(classId: number): void {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId) as ClassRow | undefined;
  if (!cls) return;
  let schedule: ScheduleEntry[];
  try {
    schedule = JSON.parse(cls.schedule || '[]');
  } catch {
    schedule = [];
  }
  if (schedule.length === 0) return;
  const days = new Set(schedule.map((s) => s.day));
  const start = cls.start_date ? parseISODate(cls.start_date) : addDays(new Date(), -90);
  const end = cls.end_date ? parseISODate(cls.end_date) : addDays(new Date(), 60);
  if (start > end) return;
  const exists = db.prepare('SELECT 1 FROM sessions WHERE class_id = ? AND date = ?');
  const insert = db.prepare('INSERT INTO sessions (class_id, date, topic) VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (!days.has(ourDayOfWeek(d))) continue;
      const iso = toISODate(d);
      if (!exists.get(classId, iso)) insert.run(classId, iso, '');
    }
  });
  tx();
}

/* ------------------------- Cập nhật trạng thái hóa đơn ------------------------- */
/* Chỉ tính các khoản đã xác nhận (status='confirmed'); khoản 'pending' chờ duyệt không tính */

export function recalcInvoiceStatus(invoiceId: number): string {
  const inv = db.prepare('SELECT amount FROM invoices WHERE id = ?').get(invoiceId) as
    { amount: number } | undefined;
  if (!inv) return 'unpaid';
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId) as { paid: number };
  const status = row.paid >= inv.amount - 0.01 ? 'paid' : row.paid > 0 ? 'partial' : 'unpaid';
  db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  return status;
}

/** Số tiền đã thanh toán (confirmed) của một hóa đơn */
export function confirmedPaid(invoiceId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId) as { paid: number };
  return row.paid;
}

/* ---------------------------------- Seed ---------------------------------- */
