import { env } from './config/env';
import { logger } from './shared/logger';
import { createApp } from './app';
import { startReminderScheduler } from './jobs/reminderScheduler';
import { db } from './db';

/** Entry point: khởi động HTTP server + scheduler nhắc học phí. */
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`EduCenter Pro API đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
  startReminderScheduler();
});

/**
 * Graceful shutdown — chuẩn production:
 * - Ngừng nhận request mới, chờ request đang xử lý xong (timeout 10s)
 * - Checkpoint WAL + đóng DB sạch (tránh corrupt khi deploy/restart)
 */
function shutdown(signal: string): void {
  logger.info(`Nhận ${signal}, đang tắt graceful...`);
  const forceTimer = setTimeout(() => {
    logger.warn('Graceful timeout, ép tắt');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      logger.info('Đã đóng DB, tắt sạch');
    } catch (err) {
      logger.warn('Lỗi khi đóng DB', { error: String(err) });
    }
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
