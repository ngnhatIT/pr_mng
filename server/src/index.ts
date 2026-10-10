import path from 'path';
import { execFile } from 'child_process';
import cron from 'node-cron';
import { env } from './config/env';
import { logger } from './shared/logger';
import { createApp } from './app';
import { startReminderScheduler, stopReminderScheduler } from './jobs/reminderScheduler';
import { startVnpayReconcileScheduler, stopVnpayReconcileScheduler } from './jobs/vnpayReconcile';
import { initDatabase, closePool, db } from './db';
import { sendAlert } from './shared/alert';
import { backupDatabase } from './db/backup';
import { withAdvisoryLock } from './shared/advisoryLock';
import { trackJob, waitForJobs } from './shared/jobTracker';

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
  void backupTask?.stop();
  void consistencyTask?.stop();
  backupTask = consistencyTask = null;
  stopVnpayReconcileScheduler();
}

function startBackupScheduler(): void {
  if (!cron.validate(env.BACKUP_CRON)) {
    logger.warn(`BACKUP_CRON không hợp lệ: "${env.BACKUP_CRON}" — tắt backup tự động`);
    return;
  }
  const dir = path.resolve(process.cwd(), 'backups');
  const runBackup = async (): Promise<void> => {
    // Advisory lock đúng cách: dedicated client giữ lock suốt quá trình (kể cả retry)
    const outcome = await withAdvisoryLock('educenter-backup', async () => {
      try {
        const r = await backupDatabase(dir, env.BACKUP_KEEP);
        logger.info('Backup định kỳ hoàn tất', { path: r.path, sizeBytes: r.sizeBytes, kept: r.kept });
      } catch (err: unknown) {
        // Retry 2 lần cách nhau 15 phút — vẫn giữ lock để instance khác không xen vào
        logger.error('Backup định kỳ THẤT BẠI, thử lại sau 15 phút', { error: String(err) });
        for (let attempt = 1; attempt <= 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 15 * 60 * 1000));
          try {
            const r = await backupDatabase(dir, env.BACKUP_KEEP);
            logger.info('Backup retry thành công', { attempt, path: r.path });
            return;
          } catch (retryErr: unknown) {
            logger.error('Backup retry THẤT BẠI', { attempt, error: String(retryErr) });
            if (attempt === 2) {
              await sendAlert('Backup DB thất bại sau 3 lần thử', String(retryErr));
              throw retryErr;
            }
          }
        }
      }
    });
    if (outcome.status === 'error') {
      logger.error('Backup thất bại hoàn toàn', { error: String(outcome.error) });
    }
  };
  backupTask = cron.schedule(
    env.BACKUP_CRON,
    // trackJob: graceful shutdown chờ job backup đang chạy xong (tối đa 30s).
    () => {
      void trackJob(runBackup());
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
    () => {
      // trackJob: graceful shutdown chờ vòng check/dọn dẹp đang chạy (tối đa 30s).
      void trackJob(
        withAdvisoryLock('educenter-consistency', async () => {
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
          // Dọn idempotency keys hết hạn (TTL 24h)
          await db
            .prepare(
              "DELETE FROM idempotency_keys WHERE created_at < to_char(NOW() - INTERVAL '24 hours', 'YYYY-MM-DD HH24:MI:SS')"
            )
            .run();
          // Dọn audit_logs cũ hơn 1 năm (retention forensic 12 tháng)
          const ar = await db
            .prepare(
              "DELETE FROM audit_logs WHERE created_at < to_char(NOW() - INTERVAL '1 year', 'YYYY-MM-DD HH24:MI:SS')"
            )
            .run();
          if ((ar.changes ?? 0) > 0) logger.info('Đã dọn audit_logs cũ', { count: ar.changes });
        } catch (err: unknown) {
          logger.error('Kiểm tra nhất quán tài chính thất bại', { error: String(err) });
        }
        })
      );
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
    logger.info(`CORS origins: ${env.CORS_ORIGIN}`);
    startReminderScheduler();
    startBackupScheduler();
    startConsistencyScheduler();
    startVnpayReconcileScheduler(); // G6: đối soát đơn VNPay treo mỗi 15 phút
  });

  /**
   * Graceful shutdown — chuẩn production:
   * - Dừng scheduler (không phát sinh job mới), chờ job đang chạy xong (tối đa 30s)
   * - Ngừng nhận request mới, chờ request đang xử lý xong
   * - Đóng PG pool sạch
   */
  async function shutdown(signal: string): Promise<void> {
    logger.info(`Nhận ${signal}, đang tắt graceful...`);
    stopSchedulers();
    stopReminderScheduler();
    // Ép tắt nếu shutdown treo quá 35s (30s chờ job + margin đóng pool/server).
    const forceTimer = setTimeout(() => {
      logger.warn('Graceful timeout, ép tắt');
      process.exit(1);
    }, 35000);
    forceTimer.unref();

    // Chờ các job cron đang chạy xong (tối đa 30s) trước khi đóng pool.
    await waitForJobs();

    // Drain keep-alive idle connections (tránh server.close() treo)
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
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

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  logger.error('Khởi động thất bại', { error: String(err) });
  process.exit(1);
});
