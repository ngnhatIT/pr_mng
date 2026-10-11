import { db } from './pg-compat';
import { createSchema, createTriggers, createHistoryTables, createViews, SCHEMA_VERSION } from './schema';
import { createIndexes } from './indexes';
import { runMigrations, bootDdlDb } from './migrations';
import { seedDatabase } from './seed';
import { backfillCenters } from './helpers';
import { seedAuthorization } from '../modules/authorization/authorization.service';

/**
 * Khởi tạo database — BẮT BUỘC await trước khi app phục vụ request
 * (xem src/index.ts). Thứ tự: schema -> migrations -> indexes
 * -> triggers -> history -> views -> backfill -> seed -> authorization.
 *
 * DATA-11/OPS-8: PM2 cluster boot nhiều worker cùng lúc — toàn bộ DDL chạy dưới
 * 1 advisory lock toàn cục (session-level, giữ trên 1 connection riêng), worker sau
 * đợi worker trước xong rồi mới chạy (lúc đó mọi thứ đã IF NOT EXISTS -> no-op).
 */
export async function initDatabase(): Promise<void> {
  const lockClient = await db.connect();
  try {
    // Worker đợi lock có thể lâu hơn statement_timeout 30s của pool -> tắt cho session này.
    await lockClient.query('SET statement_timeout = 0');
    await lockClient.query("SELECT pg_advisory_lock(hashtext('educenter-init'))");
    try {
      // N-2: DDL idempotent chỉ chạy phần còn thiếu, dưới lock_timeout (không chặn ghi khi boot/reload)
      const ddl = bootDdlDb(db);
      await createSchema(ddl);
      await runMigrations(db);
      await createIndexes(ddl);
      await createTriggers(ddl);
      await createHistoryTables(ddl);
      await createViews(ddl);
      await backfillCenters();
      await seedDatabase();
      await seedAuthorization();
    } finally {
      // Lỗi ở đây = connection đã đứt -> PG tự nhả lock; không che lỗi gốc.
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('educenter-init'))").catch(() => undefined);
    }
  } finally {
    // RESET về giá trị lúc mở connection (-c statement_timeout=30000) trước khi trả về pool.
    await lockClient.query('RESET statement_timeout').catch(() => undefined);
    lockClient.release();
  }
}

/* Re-export để mọi module dùng: import { db, toISODate } from '../db' */
export { db, closePool, getPoolStats } from './pg-compat';
export type { Db, Tx, Statement, RunResult } from './pg-compat';
export { SCHEMA_VERSION };
export * from './date-utils';
export * from './helpers';
