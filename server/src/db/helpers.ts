import { db } from './connection';
import { env } from '../config/env';
import { toISODate, addDays, ourDayOfWeek, parseISODate, ScheduleEntry, ClassRow } from './date-utils';

/**
 * Helper nghiệp vụ dùng chung: settings, sinh buổi học, tính trạng thái hóa đơn.
 * (Về lâu dài nên chuyển vào modules/<domain>/*.service.ts)
 */
export async function ensureDemoCenter(): Promise<number> {
  const row = (await db.prepare('SELECT id FROM centers ORDER BY id ASC LIMIT 1').get()) as
    { id: number } | undefined;
  if (row) return row.id;
  const r = await db
    .prepare(
      "INSERT INTO centers (name, subdomain, phone, address, plan) VALUES ('Trung tâm Demo', 'demo', '0901234567', 'TP. Hồ Chí Minh', 'premium')"
    )
    .run();
  return Number(r.lastInsertRowid);
}

async function backfillCenters(): Promise<void> {
  // CHỈ chạy khi SEED_DEMO=true: tự gán center_id cho dữ liệu NULL là hành vi
  // nguy hiểm trên production (gán nhầm tenant mà không ai hay).
  if (!env.SEED_DEMO) return;
  const demoId = await ensureDemoCenter();
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
      await db.prepare(`UPDATE ${t} SET center_id = ? WHERE center_id IS NULL`).run(demoId);
    } catch {
      /* bảng có thể chưa có cột trong trường hợp hiếm — bỏ qua */
    }
  }
  // users: gán center cho tất cả trừ superadmin (giữ NULL để bypass)
  try {
    await db
      .prepare("UPDATE users SET center_id = ? WHERE center_id IS NULL AND role != 'superadmin'")
      .run(demoId);
  } catch {
    /* bỏ qua */
  }

  // Copy cấu hình settings toàn cục (cũ) sang center_settings của trung tâm demo
  try {
    await db
      .prepare(
        'INSERT OR IGNORE INTO center_settings (center_id, key, value) SELECT ?, key, value FROM settings'
      )
      .run(demoId);
  } catch {
    /* bỏ qua */
  }
}

/** Gán center_id cho dữ liệu cũ (chạy SAU createSchema + migrations, không gọi ở top-level). */
export { backfillCenters };

/* --------------------- Đọc/ghi cấu hình (bảng settings) --------------------- */

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = (await db.prepare('SELECT value FROM settings WHERE key = ?').get(key)) as
    { value: string | null } | undefined;
  if (!row || row.value === null || row.value === undefined) return fallback;
  return row.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value);
}

/* --------------------- Cấu hình theo trung tâm --------------------- */

export async function getCenterSetting(centerId: number, key: string, fallback = ''): Promise<string> {
  const row = (await db
    .prepare('SELECT value FROM center_settings WHERE center_id = ? AND key = ?')
    .get(centerId, key)) as { value: string | null } | undefined;
  if (row && row.value !== null && row.value !== undefined) return row.value;
  return getSetting(key, fallback); // fallback về cấu hình toàn cục (tương thích DB cũ)
}

export async function setCenterSetting(centerId: number, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO center_settings (center_id, key, value) VALUES (?, ?, ?) ON CONFLICT(center_id, key) DO UPDATE SET value = excluded.value'
    )
    .run(centerId, key, value);
}

/* --------------------- Sinh buổi học từ lịch của lớp --------------------- */

export async function generateSessionsForClass(classId: number): Promise<void> {
  const cls = (await db.prepare('SELECT * FROM classes WHERE id = ?').get(classId)) as ClassRow | undefined;
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
  await db.transaction(async (tx) => {
    const txExists = tx.prepare('SELECT 1 FROM sessions WHERE class_id = ? AND date = ?');
    const txInsert = tx.prepare('INSERT INTO sessions (class_id, date, topic) VALUES (?, ?, ?)');
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (!days.has(ourDayOfWeek(d))) continue;
      const iso = toISODate(d);
      if (!(await txExists.get(classId, iso))) await txInsert.run(classId, iso, '');
    }
  });
}

/* ------------------------- Cập nhật trạng thái hóa đơn ------------------------- */
/* Chỉ tính các khoản đã xác nhận (status='confirmed'); khoản 'pending' chờ duyệt không tính */

export async function recalcInvoiceStatus(invoiceId: number): Promise<string> {
  const inv = (await db.prepare('SELECT amount FROM invoices WHERE id = ?').get(invoiceId)) as
    { amount: number } | undefined;
  if (!inv) return 'unpaid';
  const row = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId)) as { paid: number };
  const status = row.paid >= inv.amount - 0.01 ? 'paid' : row.paid > 0 ? 'partial' : 'unpaid';
  await db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  return status;
}

/** Số tiền đã thanh toán (confirmed) của một hóa đơn */
export async function confirmedPaid(invoiceId: number): Promise<number> {
  const row = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId)) as { paid: number };
  return row.paid;
}

/* ---------------------------------- Seed ---------------------------------- */
