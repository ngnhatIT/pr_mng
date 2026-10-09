import { env } from './config/env';
import { logger } from './shared/logger';
import { createApp } from './app';
import { startReminderScheduler } from './jobs/reminderScheduler';
import { initDatabase, closePool } from './db';

/** Entry point: khởi tạo DB -> HTTP server + scheduler nhắc học phí. */
async function main(): Promise<void> {
  await initDatabase();
  logger.info('Database PostgreSQL đã sẵn sàng');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`EduCenter Pro API đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
    startReminderScheduler();
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
