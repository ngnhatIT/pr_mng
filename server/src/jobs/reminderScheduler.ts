import cron from 'node-cron';
import { db, toISODate } from '../db';
import { getZaloConfig, sendTuitionReminder } from '../services/zalo';
import { listCenters, hasFeature, Center } from '../utils/plans';
import { logger } from '../shared/logger';
import { formatError } from '../shared/errorFormat';
import { DAY_MS } from '../shared/time';
import { publishScheduled } from '../modules/homework/homework.service';
import { withAdvisoryLock } from '../shared/advisoryLock';

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
/** Ngày đã chạy tự động theo từng center — tránh chạy trùng trong ngày */
const autoRunDays = new Set<string>();

/** Dọn entries cũ (không phải hôm nay) để tránh rò rỉ bộ nhớ */
function pruneAutoRunDays(today: string): void {
  for (const key of autoRunDays) {
    if (!key.endsWith(`:${today}`)) autoRunDays.delete(key);
  }
}

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
  const overdueCutoff = toISODate(new Date(Date.now() - overdueDays * DAY_MS));
  const overdue = (await db
    .prepare(
      `SELECT i.id, i.due_date FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE s.center_id = ? AND i.status IN ('unpaid','partial') AND i.due_date IS NOT NULL AND i.due_date < ?
       ORDER BY i.due_date ASC`
    )
    .all(centerId, overdueCutoff)) as DueInvoice[];

  // Sắp đến hạn: hạn nộp từ hôm nay đến (hôm nay + upcoming_days)
  const upcomingLimit = toISODate(new Date(Date.now() + upcomingDays * DAY_MS));
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
  // Chỉ tính 'sent'/'demo' — 'failed' không suppress để lần chạy sau retry lại.
  // 'sending' quá 30 phút coi như kẹt do crash → cho phép gửi lại (tránh mất nhắc 3 ngày).
  const row = await db
    .prepare(
      `SELECT 1 FROM reminders
       WHERE invoice_id = ? AND kind = ?
       AND (
         (status IN ('sent', 'demo') AND created_at >= datetime('now', '-3 days'))
         OR (status = 'sending' AND created_at >= datetime('now', '-30 minutes'))
       )
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
  const outcome = await withAdvisoryLock(lockKey, async () => {
    // Giới hạn số ZNS mỗi lần chạy để kiểm soát chi phí (500 hóa đơn = 500 tin tính tiền)
    const MAX_PER_RUN = 100;
    let sentCount = 0;
    for (const center of centers) {
      const { overdue, upcoming } = await findDueInvoices(center.id);
      const process = async (list: DueInvoice[], kind: 'overdue' | 'upcoming') => {
        for (const inv of list) {
          if (sentCount >= MAX_PER_RUN) {
            log.warn(`Đạt giới hạn ${MAX_PER_RUN} tin/lần chạy, bỏ qua phần còn lại`, {
              center: center.name,
            });
            break;
          }
          try {
            // wasRemindedRecently nằm TRONG try/catch: lỗi DB transient
            // không abort cả vòng chạy, chỉ ghi failed cho hóa đơn này
            if (await wasRemindedRecently(inv.id, kind)) {
              result.skipped++;
              continue;
            }
            // Dùng cùng lock key với manual remind (remind:{id}:{kind}) để chống race
            // khi admin bấm nhắc thủ công đúng lúc scheduler đang chạy
            const r = await withAdvisoryLock(`remind:${inv.id}:${kind}`, async () => {
              // Re-check sau khi giữ lock (chống interleaving)
              if (await wasRemindedRecently(inv.id, kind)) {
                return { status: 'skipped' as const, message: 'Đã nhắc gần đây' };
              }
              return sendTuitionReminder(inv.id, kind, center.id);
            });
            if (r.status === 'sent') sentCount++;
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
  });
  if (outcome.status === 'locked') {
    log.info('Bỏ qua vòng nhắc: instance khác đang chạy', { lockKey });
  }
  return result;
}

/**
 * Khởi động scheduler: kiểm tra mỗi phút, chạy khi đến giờ cấu hình của từng trung tâm.
 * Trung tâm không có tính năng 'zalo_auto' (gói basic) sẽ bị bỏ qua.
 */
let reminderTask: ReturnType<typeof cron.schedule> | null = null;

export function stopReminderScheduler(): void {
  reminderTask?.stop();
  reminderTask = null;
}

export function startReminderScheduler(): void {
  reminderTask = cron.schedule(
    '* * * * *',
    () => {
      (async () => {
        try {
          // Dọn entries cũ mỗi phút để tránh rò rỉ bộ nhớ
          pruneAutoRunDays(nowVN().today);
          // Tự đăng bài tập đã hẹn giờ (Google Classroom: Schedule post)
          const published = await publishScheduled();
          if (published > 0) log.info(`Đã tự đăng ${published} bài tập hẹn giờ`);
        } catch (err) {
          log.error('Lỗi tự đăng bài tập hẹn giờ', { error: formatError(err) });
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
              .catch((err) => log.error('Lỗi vòng nhắc', { error: formatError(err) }));
          }
        } catch (err) {
          log.error('Lỗi scheduler', { error: formatError(err) });
        }
      })().catch((err) => log.error('Lỗi scheduler', { error: formatError(err) }));
    },
    { timezone: VN_TZ }
  );
  log.info('Scheduler đã khởi động (kiểm tra mỗi phút, múi giờ Asia/Ho_Chi_Minh)');
}
