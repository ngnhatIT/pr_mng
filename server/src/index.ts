import path from 'path';
import { execFile } from 'child_process';
import cron from 'node-cron';
import { env } from './config/env';
import { logger } from './shared/logger';
import { createApp } from './app';
import { startReminderScheduler } from './jobs/reminderScheduler';
import { initDatabase, closePool } from './db';
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
  if (!env.IS_PROD) process.exit(1);
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
function startBackupScheduler(): void {
  if (!cron.validate(env.BACKUP_CRON)) {
    logger.warn(`BACKUP_CRON không hợp lệ: "${env.BACKUP_CRON}" — tắt backup tự động`);
    return;
  }
  const dir = path.resolve(process.cwd(), 'backups');
  cron.schedule(
    env.BACKUP_CRON,
    async () => {
      try {
        const r = await backupDatabase(dir, env.BACKUP_KEEP);
        logger.info('Backup định kỳ hoàn tất', { path: r.path, sizeBytes: r.sizeBytes, kept: r.kept });
      } catch (err: unknown) {
        logger.error('Backup định kỳ THẤT BẠI', { error: String(err) });
      }
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );
  logger.info(
    `Đã lên lịch backup tự động: "${env.BACKUP_CRON}" (Asia/Ho_Chi_Minh), giữ ${env.BACKUP_KEEP} bản tại ${dir}`
  );
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
  });

  /**
   * Graceful shutdown — chuẩn production:
   * - Ngừng nhận request mới, chờ request đang xử lý xong (timeout 10s)
   * - Đóng PG pool sạch
   */
  function shutdown(signal: string): void {
    logger.info(`Nhận ${signal}, đang tắt graceful...`);
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
