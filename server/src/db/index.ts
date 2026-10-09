import { db } from './connection';
import { createSchema, createTriggers, createViews } from './schema';
import { createIndexes } from './indexes';
import { runMigrations } from './migrations';
import { runVersionedMigrations } from './versionedMigrations';
import { seedDatabase } from './seed';
import { backfillCenters } from './helpers';

/* Khởi tạo DB: schema -> migration (cũ) -> migration (versioned) -> indexes
 * -> triggers -> views -> backfill -> seed */
createSchema(db);
runMigrations(db);
runVersionedMigrations(db);
createIndexes(db);
createTriggers(db);
createViews(db);
backfillCenters();
seedDatabase();

/* Re-export để mọi module dùng: import { db, toISODate } from '../db' */
export { db } from './connection';
export type { Db } from './connection';
export * from './date-utils';
export * from './helpers';
