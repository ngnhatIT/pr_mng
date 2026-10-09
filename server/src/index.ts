import path from 'path';
import { execFile } from 'child_process';
import cron from 'node-cron';
import { env } from './config/env';
import { logger } from './shared/logger';
import { createApp } from './app';
import { startReminderScheduler, stopReminderScheduler } from './jobs/reminderScheduler';
import { initDatabase, closePool, db } from './db';
import { sendAlert } from './shared/alert';
import { backupDatabase } from './db/backup';

/**
 * Bẫy lỗi toàn cục — chuẩn production:
 * - unhandledRejection: log; production KHÔNG crash ngay (giữ phục vụ),
 *   dev throw để thấy lỗi tức thì.
 * - uncaughtException: log; dev crash ngay, production log và tiếp tục
 *   (đã ghi nhận rủi ro trạng thái không xác định — cân nhắc crash nếu
 *   lỗi lặp lại).
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', { error: String(reason) });
  if (!env.IS_PROD) throw reason;
});

process.on('uncaughtException', (err: unknown) => {
  logger.error('Uncaught exception', { error: String(err) });
  // Production: crash ngay để process manager restart với trạng thái sạch.
  // Tiếp tục phục vụ sau uncaughtException = trạng thái không xác định (rủi ro dữ liệu).
  process.exit(1);
});

/** Kiểm tra pg_dump tồn tại trong PATH (backup tự động cần nó). */
function checkPgDump(): void {
  execFile('pg_dump', ['--version'], (err) => {
    if (err) {
      logger.warn(
        'Không tìm thấy pg_dump trong PATH — backup tự động sẽ thất bại, hãy cài postgresql-client'
      );
    }
  });
}

/**
 * Backup tự động theo lịch BACKUP_CRON (mặc định '0 2 * * *'),
 * múi giờ Asia/Ho_Chi_Minh, giữ BACKUP_KEEP bản mới nhất.
 * Lỗi backup chỉ log (không crash app) — nhưng PHẢI được giám sát.
 */
let backupTask: ReturnType<typeof cron.schedule> | null = null;
let consistencyTask: ReturnType<typeof cron.schedule> | null = null;

export function stopSchedulers(): void {
  backupTask?.stop();
  consistencyTask?.stop();
  backupTask = consistencyTask = null;
}

function startBackupScheduler(): void {
  if (!cron.validate(env.BACKUP_CRON)) {
    logger.warn(`BACKUP_CRON không hợp lệ: "${env.BACKUP_CRON}" — tắt backup tự động`);
    return;
  }
  const dir = path.resolve(process.cwd(), 'backups');
  backupTask = cron.schedule(
    env.BACKUP_CRON,
    async () => {
      // Advisory lock: 2 instance không backup đè nhau
      let locked = false;
      try {
        const r = await db.query('SELECT pg_try_advisory_lock(hashtext($1)) as locked', ['educenter-backup']);
        locked = (r.rows[0] as { locked: boolean } | undefined)?.locked === true;
      } catch {
        locked = true; // fail-open
      }
      if (!locked) {
        logger.info('Bỏ qua backup: instance khác đang chạy');
        return;
      }
      try {
        const r = await backupDatabase(dir, env.BACKUP_KEEP);
        logger.info('Backup định kỳ hoàn tất', { path: r.path, sizeBytes: r.sizeBytes, kept: r.kept });
      } catch (err: unknown) {
        // Retry 2 lần cách nhau 15 phút (backup fail một đêm = mất cả chu kỳ 24h)
        // Chạy async không block cron thread (dùng setTimeout thay vì await)
        logger.error('Backup định kỳ THẤT BẠI, thử lại sau 15 phút', { error: String(err) });
        void (async () => {
          for (let attempt = 1; attempt <= 2; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 15 * 60 * 1000));
            try {
              const r = await backupDatabase(dir, env.BACKUP_KEEP);
              logger.info('Backup retry thành công', { attempt, path: r.path });
              break;
            } catch (retryErr: unknown) {
              logger.error('Backup retry THẤT BẠI', { attempt, error: String(retryErr) });
              if (attempt === 2) {
                // Hết retry: gửi cảnh báo webhook (nếu cấu hình) — backup chết lặng rất nguy hiểm
                await sendAlert('Backup DB thất bại sau 3 lần thử', String(retryErr));
              }
            }
          }
        })();
      } finally {
        try {
          await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['educenter-backup']);
        } catch {
          /* bỏ qua */
        }
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );
  logger.info(
    `Đã lên lịch backup tự động: "${env.BACKUP_CRON}" (Asia/Ho_Chi_Minh), giữ ${env.BACKUP_KEEP} bản tại ${dir}`
  );
}

/**
 * Kiểm tra nhất quán tài chính định kỳ (phát hiện lệch công nợ ở production).
 * Chạy mỗi giờ; có vấn đề thì log ERROR để hệ giám sát bắt được.
 */
function startConsistencyScheduler(): void {
  consistencyTask = cron.schedule(
    '0 * * * *',
    async () => {
      // Advisory lock: chỉ 1 instance chạy (chống 2 instance cùng DELETE/consistency)
      let locked = false;
      try {
        const r = (await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
          'educenter-consistency',
        ])) as { rows: { locked: boolean }[] };
        locked = r.rows[0]?.locked ?? false;
      } catch {
        locked = true; // fail-open
      }
      if (!locked) {
        logger.info('Bỏ qua consistency: instance khác đang chạy');
        return;
      }
      try {
        const { checkFinancialConsistency } = await import('./db/consistency.js');
        const issues = await checkFinancialConsistency(db);
        if (issues.length > 0) {
          logger.error('Phát hiện lệch dữ liệu tài chính', { count: issues.length, issues });
        }
        // Dọn refresh token hết hạn (chống phình bảng)
        const r = await db
          .prepare("DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days'")
          .run();
        if ((r.changes ?? 0) > 0) logger.info('Đã dọn refresh token hết hạn', { count: r.changes });
      } catch (err: unknown) {
        logger.error('Kiểm tra nhất quán tài chính thất bại', { error: String(err) });
      } finally {
        try {
          await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['educenter-consistency']);
        } catch {
          /* bỏ qua */
        }
      }
      // Dọn idempotency keys hết hạn (TTL 24h) — cron độc lập, không phụ thuộc traffic
      try {
        await db
          .prepare(
            "DELETE FROM idempotency_keys WHERE created_at < to_char(NOW() - INTERVAL '24 hours', 'YYYY-MM-DD HH24:MI:SS')"
          )
          .run();
      } catch {
        /* bỏ qua */
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );
  logger.info('Đã lên lịch kiểm tra nhất quán tài chính mỗi giờ');
}

/** Entry point: khởi tạo DB -> HTTP server + scheduler nhắc học phí. */
async function main(): Promise<void> {
  checkPgDump();
  await initDatabase();
  logger.info('Database PostgreSQL đã sẵn sàng');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`EduCenter Pro API đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
    startReminderScheduler();
    startBackupScheduler();
    startConsistencyScheduler();
  });

  /**
   * Graceful shutdown — chuẩn production:
   * - Ngừng nhận request mới, chờ request đang xử lý xong (timeout 10s)
   * - Đóng PG pool sạch
   */
  function shutdown(signal: string): void {
    logger.info(`Nhận ${signal}, đang tắt graceful...`);
    stopSchedulers();
    stopReminderScheduler();
    const forceTimer = setTimeout(() => {
      logger.warn('Graceful timeout, ép tắt');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    server.close(() => {
      closePool()
        .then(() => logger.info('Đã đóng PG pool, tắt sạch'))
        .catch((err: unknown) => logger.warn('Lỗi khi đóng PG pool', { error: String(err) }))
        .finally(() => {
          clearTimeout(forceTimer);
          process.exit(0);
        });
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('Khởi động thất bại', { error: String(err) });
  process.exit(1);
});
