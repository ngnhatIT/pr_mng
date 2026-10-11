import { db } from './connection';
import type { Tx } from './pg-compat';
import { env } from '../config/env';
import { toISODate, addDays, ScheduleEntry, ClassRow } from './date-utils';

/**
 * Helper nghiệp vụ dùng chung: settings, sinh buổi học, tính trạng thái hóa đơn.
 * (Về lâu dài nên chuyển vào modules/<domain>/*.service.ts)
 */
export async function ensureDemoCenter(): Promise<number> {
  // Chỉ trả về center DEMO (subdomain='demo'), KHÔNG trả về center đầu tiên bất kỳ
  // (tránh nhét dữ liệu demo vào tenant thật khi SEED_DEMO bật nhầm)
  const row = (await db.prepare("SELECT id FROM centers WHERE subdomain = 'demo' LIMIT 1").get()) as
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

/* --------------------- Cấu hình theo trung tâm --------------------- */

/**
 * Cache kết quả getCenterSettings — TTL 60s để đổi cấu hình có hiệu lực nhanh
 * mà mỗi request không query DB lặp lại (mỗi lần tạo link thanh toán từng tốn
 * tới 10 query tuần tự: 1 query chính + 1 query fallback cho mỗi key thiếu).
 * Pattern giống cache permissions ở authorization.service.ts.
 */
const centerSettingsCache = new Map<string, { at: number; values: Map<string, string> }>();
const CENTER_SETTINGS_TTL_MS = 60_000;

/** Xóa cache cấu hình của 1 center — gọi sau mỗi lần setCenterSetting. */
export function invalidateCenterSettings(centerId: number): void {
  const prefix = `${centerId}::`;
  for (const key of centerSettingsCache.keys()) {
    if (key.startsWith(prefix)) centerSettingsCache.delete(key);
  }
}

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
  invalidateCenterSettings(centerId); // đọc sau set phải thấy giá trị mới, không đọc cache cũ
}

/**
 * Đọc NHIỀU setting của 1 center trong 1 query (thay vì N lần getCenterSetting).
 * Trả về Map đủ các key yêu cầu (thiếu -> fallback từng key về settings toàn cục).
 */
export async function getCenterSettings(
  centerId: number,
  keys: string[],
  fallback = ''
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  // Key cache gồm centerId + danh sách keys (sắp xếp để thứ tự truyền vào không ảnh hưởng).
  const cacheKey = `${centerId}::${[...keys].sort().join(',')}`;
  const hit = centerSettingsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CENTER_SETTINGS_TTL_MS) return hit.values;
  const placeholders = keys.map(() => '?').join(',');
  const rows = (await db
    .prepare(`SELECT key, value FROM center_settings WHERE center_id = ? AND key IN (${placeholders})`)
    .all(centerId, ...keys)) as { key: string; value: string | null }[];
  for (const r of rows) {
    if (r.value !== null && r.value !== undefined) out.set(r.key, r.value);
  }
  for (const k of keys) {
    if (!out.has(k)) out.set(k, await getSetting(k, fallback));
  }
  centerSettingsCache.set(cacheKey, { at: Date.now(), values: out });
  return out;
}

/* --------------------- Sinh buổi học từ lịch của lớp --------------------- */

/** Lớp không có ngày kết thúc: sinh trước bấy nhiêu ngày; job hằng ngày nối thêm (extendActiveClassSessions). */
export const SESSION_HORIZON_DAYS = 90;

type Q = Pick<Tx, 'prepare'>;

/** Các thứ (2..8) hợp lệ trong lịch JSON của lớp — số nguyên đã kiểm, an toàn để nối vào SQL. */
export function scheduleDays(scheduleJson: string | null | undefined): number[] {
  let schedule: ScheduleEntry[];
  try {
    schedule = JSON.parse(scheduleJson || '[]');
  } catch {
    schedule = [];
  }
  if (!Array.isArray(schedule)) return [];
  const days = schedule.map((s) => Number(s?.day)).filter((d) => Number.isInteger(d) && d >= 2 && d <= 8);
  return [...new Set(days)];
}

/**
 * Sinh buổi học theo lịch của lớp bằng 1 câu INSERT ... SELECT generate_series (thay vòng lặp N INSERT).
 * Khoảng: [max(start_date ?? hôm nay, opts.from), end_date ?? hôm nay + SESSION_HORIZON_DAYS].
 * ON CONFLICT DO NOTHING: buổi đã có (kể cả đã hủy status='cancelled') giữ nguyên, không bị "hồi sinh".
 * KHÔNG gọi khi đọc (GET) — chỉ khi tạo/sửa lớp và job nối lịch hằng ngày.
 */
export async function generateSessionsForClass(
  classId: number,
  opts: { from?: string; q?: Q } = {}
): Promise<number> {
  const q = opts.q ?? db;
  const cls = (await q
    .prepare('SELECT id, schedule, start_date, end_date, teacher_id FROM classes WHERE id = ?')
    .get(classId)) as
    Pick<ClassRow, 'id' | 'schedule' | 'start_date' | 'end_date' | 'teacher_id'> | undefined;
  if (!cls) return 0;
  const days = scheduleDays(cls.schedule);
  if (days.length === 0) return 0;
  let from = cls.start_date || toISODate(new Date());
  if (opts.from && opts.from > from) from = opts.from;
  const to = cls.end_date || toISODate(addDays(new Date(), SESSION_HORIZON_DAYS));
  if (from > to) return 0;
  // Quy ước thứ của app: 2=T2..8=CN = ISODOW (1=T2..7=CN) + 1
  const r = await q
    .prepare(
      `INSERT INTO sessions (class_id, date, topic, teacher_id)
       SELECT ?, to_char(d, 'YYYY-MM-DD'), '', ?
       FROM generate_series(?::date, ?::date, interval '1 day') AS d
       WHERE EXTRACT(ISODOW FROM d)::int + 1 IN (${days.join(',')})
       ON CONFLICT (class_id, date) DO NOTHING`
    )
    .run(classId, cls.teacher_id, from, to);
  return r.changes ?? 0;
}

/** Job hằng ngày: nối lịch cho mọi lớp đang hoạt động tới hôm nay + SESSION_HORIZON_DAYS. */
export async function extendActiveClassSessions(): Promise<number> {
  const today = toISODate(new Date());
  const rows = (await db
    .prepare(
      "SELECT id FROM classes WHERE status = 'active' AND (end_date IS NULL OR end_date = '' OR end_date >= ?)"
    )
    .all(today)) as { id: number }[];
  let total = 0;
  for (const r of rows) total += await generateSessionsForClass(r.id, { from: today });
  return total;
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
  // DATA-19: chỉ UPDATE khi đổi trạng thái (tránh bump version + ghi invoice_history vô ích)
  await db
    .prepare('UPDATE invoices SET status = ? WHERE id = ? AND status <> ?')
    .run(status, invoiceId, status);
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
