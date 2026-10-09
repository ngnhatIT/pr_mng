import { db } from './pg-compat';
import { createSchema, createTriggers, createHistoryTables, createViews, SCHEMA_VERSION } from './schema';
import { createIndexes } from './indexes';
import { runMigrations } from './migrations';
import { seedDatabase } from './seed';
import { backfillCenters } from './helpers';
import { seedAuthorization } from '../modules/authorization/authorization.service';

/**
 * Khởi tạo database — BẮT BUỘC await trước khi app phục vụ request
 * (xem src/index.ts). Thứ tự: schema -> migrations -> indexes
 * -> triggers -> history -> views -> backfill -> seed -> authorization.
 */
export async function initDatabase(): Promise<void> {
  await createSchema(db);
  await runMigrations(db);
  await createIndexes(db);
  await createTriggers(db);
  await createHistoryTables(db);
  await createViews(db);
  await backfillCenters();
  await seedDatabase();
  await seedAuthorization();
}

/* Re-export để mọi module dùng: import { db, toISODate } from '../db' */
export { db, closePool } from './pg-compat';
export type { Db, Tx, Statement, RunResult } from './pg-compat';
export { SCHEMA_VERSION };
export * from './date-utils';
export * from './helpers';
