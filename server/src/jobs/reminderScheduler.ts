import cron from 'node-cron';
import { db, toISODate } from '../db';
import { getZaloConfig, sendTuitionReminder } from '../services/zalo';
import { listCenters, hasFeature, Center } from '../utils/plans';
import { logger } from '../shared/logger';
import { publishScheduled } from '../modules/homework/homework.service';

const log = logger.scope('reminders');

/** Ngày đã chạy tự động theo từng center — tránh chạy trùng trong ngày */
const autoRunDays = new Set<string>();

interface DueInvoice {
  id: number;
  due_date: string | null;
}

/** Tìm hóa đơn cần nhắc của 1 trung tâm: quá hạn và sắp đến hạn (chưa thanh toán đủ) */
async function findDueInvoices(centerId: number): Promise<{ overdue: DueInvoice[]; upcoming: DueInvoice[] }> {
  const cfg = await getZaloConfig(centerId);
  const overdueDays = Math.max(0, Number(cfg.reminder_overdue_days) || 0);
  const upcomingDays = Math.max(0, Number(cfg.reminder_upcoming_days) || 0);
  const today = toISODate(new Date());

  // Quá hạn: hạn nộp sớm hơn (hôm nay - overdue_days)
  const overdueCutoff = toISODate(new Date(Date.now() - overdueDays * 86400000));
  const overdue = await db.prepare(
      `SELECT i.id, i.due_date FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE s.center_id = ? AND i.status IN ('unpaid','partial') AND i.due_date IS NOT NULL AND i.due_date < ?
       ORDER BY i.due_date ASC`
    )
    .all(centerId, overdueCutoff) as DueInvoice[];

  // Sắp đến hạn: hạn nộp từ hôm nay đến (hôm nay + upcoming_days)
  const upcomingLimit = toISODate(new Date(Date.now() + upcomingDays * 86400000));
  const upcoming = await db.prepare(
      `SELECT i.id, i.due_date FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE s.center_id = ? AND i.status IN ('unpaid','partial') AND i.due_date IS NOT NULL
         AND i.due_date >= ? AND i.due_date <= ?
       ORDER BY i.due_date ASC`
    )
    .all(centerId, today, upcomingLimit) as DueInvoice[];

  return { overdue, upcoming };
}

/** Chống spam: bỏ qua hóa đơn đã được nhắc cùng loại trong 3 ngày gần nhất */
async function wasRemindedRecently(invoiceId: number, kind: 'overdue' | 'upcoming'): Promise<boolean> {
  const row = await db.prepare(
      `SELECT 1 FROM reminders
       WHERE invoice_id = ? AND kind = ? AND created_at >= datetime('now', '-3 days')
       LIMIT 1`
    )
    .get(invoiceId, kind);
  return !!row;
}

export interface RunOnceResult {
  overdue: number;
  upcoming: number;
  skipped: number;
  details: { invoiceId: number; kind: string; status: string; message: string }[];
}

/**
 * Chạy một vòng quét + gửi nhắc cho 1 trung tâm (hoặc mọi trung tâm có tính năng).
 * Dùng cho cả scheduler tự động và trigger thủ công.
 */
export async function runReminderOnce(centerId?: number): Promise<RunOnceResult> {
  const centers: Center[] =
    typeof centerId === 'number'
      ? (await listCenters()).filter((c) => c.id === centerId)
      : (await listCenters()).filter((c) => hasFeature(c, 'zalo_auto'));

  const result: RunOnceResult = { overdue: 0, upcoming: 0, skipped: 0, details: [] };

  for (const center of centers) {
    const { overdue, upcoming } = await findDueInvoices(center.id);
    const process = async (list: DueInvoice[], kind: 'overdue' | 'upcoming') => {
      for (const inv of list) {
        if (await wasRemindedRecently(inv.id, kind)) {
          result.skipped++;
          continue;
        }
        try {
          const r = await sendTuitionReminder(inv.id, kind, center.id);
          if (kind === 'overdue') result.overdue++;
          else result.upcoming++;
          result.details.push({ invoiceId: inv.id, kind, status: r.status, message: r.message });
          log.info(`Hóa đơn #${inv.id}: ${r.message}`, { center: center.name, kind });
        } catch (err) {
          result.details.push({
            invoiceId: inv.id,
            kind,
            status: 'failed',
            message: err instanceof Error ? err.message : 'Lỗi không xác định',
          });
        }
      }
    };
    await process(overdue, 'overdue');
    await process(upcoming, 'upcoming');
  }
  return result;
}

/**
 * Khởi động scheduler: kiểm tra mỗi phút, chạy khi đến giờ cấu hình của từng trung tâm.
 * Trung tâm không có tính năng 'zalo_auto' (gói basic) sẽ bị bỏ qua.
 */
export function startReminderScheduler(): void {
  cron.schedule('* * * * *', () => {
    (async () => {
    try {
      // Tự đăng bài tập đã hẹn giờ (Google Classroom: Schedule post)
      const published = await publishScheduled();
      if (published > 0) log.info(`Đã tự đăng ${published} bài tập hẹn giờ`);
    } catch (err) {
      log.error('Lỗi tự đăng bài tập hẹn giờ', { error: String(err) });
    }
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = toISODate(now);
      for (const center of await listCenters()) {
        if (!hasFeature(center, 'zalo_auto')) continue;
        const cfg = await getZaloConfig(center.id);
        if (cfg.zalo_enabled !== '1') continue;
        if (hhmm !== cfg.reminder_hour) continue;
        const key = `${center.id}:${today}`;
        if (autoRunDays.has(key)) continue;
        autoRunDays.add(key);
        log.info(`Bắt đầu vòng nhắc tự động lúc ${hhmm}`, { center: center.name });
        runReminderOnce(center.id)
          .then((r) => {
            log.info(
              `Xong: ${r.overdue} quá hạn, ${r.upcoming} sắp đến hạn, ${r.skipped} bỏ qua (chống spam)`,
              { center: center.name }
            );
          })
          .catch((err) => log.error('Lỗi vòng nhắc', { error: String(err) }));
      }
    } catch (err) {
      log.error('Lỗi scheduler', { error: String(err) });
    }
    })().catch((err) => log.error('Lỗi scheduler', { error: String(err) }));
  });
  log.info('Scheduler đã khởi động (kiểm tra mỗi phút, theo từng trung tâm)');
}
