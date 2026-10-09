import cron from 'node-cron';
import { db, toISODate } from '../db';
import { getZaloConfig, sendTuitionReminder } from '../services/zalo';
import { listCenters, hasFeature, Center } from '../utils/plans';
import { logger } from '../shared/logger';
import { publishScheduled } from '../modules/homework/homework.service';

const log = logger.scope('reminders');

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Giờ hiện tại theo Asia/Ho_Chi_Minh (không phụ thuộc TZ của server) */
function nowVN(): { hhmm: string; today: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { hhmm: `${get('hour')}:${get('minute')}`, today: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Advisory lock chống 2 instance cùng chạy vòng nhắc (multi-instance deploy) */
async function tryAdvisoryLock(key: string): Promise<boolean> {
  try {
    const r = await db.query('SELECT pg_try_advisory_lock(hashtext($1)) as locked', [key]);
    return (r.rows[0] as { locked: boolean } | undefined)?.locked === true;
  } catch {
    return true; // không lấy được lock info → cứ chạy (fail-open, giữ hành vi cũ)
  }
}

async function releaseAdvisoryLock(key: string): Promise<void> {
  try {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
  } catch {
    /* bỏ qua */
  }
}

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
  // Ngày theo giờ Việt Nam (không phụ thuộc TZ server)
  const today = nowVN().today;

  // Quá hạn: hạn nộp sớm hơn (hôm nay - overdue_days)
  const overdueCutoff = toISODate(new Date(Date.now() - overdueDays * 86400000));
  const overdue = (await db
    .prepare(
      `SELECT i.id, i.due_date FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE s.center_id = ? AND i.status IN ('unpaid','partial') AND i.due_date IS NOT NULL AND i.due_date < ?
       ORDER BY i.due_date ASC`
    )
    .all(centerId, overdueCutoff)) as DueInvoice[];

  // Sắp đến hạn: hạn nộp từ hôm nay đến (hôm nay + upcoming_days)
  const upcomingLimit = toISODate(new Date(Date.now() + upcomingDays * 86400000));
  const upcoming = (await db
    .prepare(
      `SELECT i.id, i.due_date FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE s.center_id = ? AND i.status IN ('unpaid','partial') AND i.due_date IS NOT NULL
         AND i.due_date >= ? AND i.due_date <= ?
       ORDER BY i.due_date ASC`
    )
    .all(centerId, today, upcomingLimit)) as DueInvoice[];

  return { overdue, upcoming };
}

/** Chống spam: bỏ qua hóa đơn đã được nhắc cùng loại trong 3 ngày gần nhất */
async function wasRemindedRecently(invoiceId: number, kind: 'overdue' | 'upcoming'): Promise<boolean> {
  const row = await db
    .prepare(
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

  // Chống 2 instance cùng gửi trùng (multi-instance): chỉ 1 bên giữ lock được chạy
  const lockKey = `reminder-run:${typeof centerId === 'number' ? centerId : 'all'}`;
  const locked = await tryAdvisoryLock(lockKey);
  if (!locked) {
    log.info('Bỏ qua vòng nhắc: instance khác đang chạy', { lockKey });
    return result;
  }
  try {
    for (const center of centers) {
      const { overdue, upcoming } = await findDueInvoices(center.id);
      const process = async (list: DueInvoice[], kind: 'overdue' | 'upcoming') => {
        for (const inv of list) {
          try {
            // wasRemindedRecently nằm TRONG try/catch: lỗi DB transient
            // không abort cả vòng chạy, chỉ ghi failed cho hóa đơn này
            if (await wasRemindedRecently(inv.id, kind)) {
              result.skipped++;
              continue;
            }
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
  } finally {
    await releaseAdvisoryLock(lockKey);
  }
  return result;
}

/**
 * Khởi động scheduler: kiểm tra mỗi phút, chạy khi đến giờ cấu hình của từng trung tâm.
 * Trung tâm không có tính năng 'zalo_auto' (gói basic) sẽ bị bỏ qua.
 */
export function startReminderScheduler(): void {
  cron.schedule(
    '* * * * *',
    () => {
      (async () => {
        try {
          // Tự đăng bài tập đã hẹn giờ (Google Classroom: Schedule post)
          const published = await publishScheduled();
          if (published > 0) log.info(`Đã tự đăng ${published} bài tập hẹn giờ`);
        } catch (err) {
          log.error('Lỗi tự đăng bài tập hẹn giờ', { error: String(err) });
        }
        try {
          // Giờ Việt Nam — không phụ thuộc TZ của server
          const { hhmm, today } = nowVN();
          for (const center of await listCenters()) {
            if (!hasFeature(center, 'zalo_auto')) continue;
            const cfg = await getZaloConfig(center.id);
            if (cfg.zalo_enabled !== '1') continue;
            if (!/^\d{2}:\d{2}$/.test(cfg.reminder_hour || '')) continue;
            const key = `${center.id}:${today}`;
            if (autoRunDays.has(key)) continue;
            // Catch-up: server down đúng phút reminder_hour → chạy bù nếu đã qua giờ
            // và hôm nay chưa chạy
            if (hhmm < cfg.reminder_hour) continue;
            autoRunDays.add(key);
            log.info(`Bắt đầu vòng nhắc tự động lúc ${hhmm} (giờ VN)`, { center: center.name });
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
    },
    { timezone: VN_TZ }
  );
  log.info('Scheduler đã khởi động (kiểm tra mỗi phút, múi giờ Asia/Ho_Chi_Minh)');
}
