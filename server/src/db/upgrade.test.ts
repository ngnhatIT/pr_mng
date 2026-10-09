/**
 * Test migration baseline PostgreSQL (db/migrations.ts):
 * - schema_migrations được tạo và ghi version baseline
 * - Chạy lại idempotent (không duplicate, không lỗi)
 * - SCHEMA_VERSION = 1 cho baseline PG
 */
// LƯU Ý: Chạy test với DATABASE_URL trỏ tới test DB:
//   DATABASE_URL=postgres://educenter:educenter123@localhost:5432/educenter_test node --test ...
// (pg-compat đọc DATABASE_URL lúc load module — không set trong file vì ES module hoist imports)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { runMigrations } from './migrations';
import { SCHEMA_VERSION } from './schema';
import { setupTestDb, teardownTestDb } from './test-utils';

describe('migrations PostgreSQL baseline', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('SCHEMA_VERSION = 1 cho baseline PostgreSQL', () => {
    assert.equal(SCHEMA_VERSION, 1);
  });

  it('schema_migrations ghi version baseline', async () => {
    const r = await db.query('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1');
    const row = r.rows[0] as { version: number; name: string };
    assert.equal(row.version, SCHEMA_VERSION);
    assert.equal(row.name, 'pg_baseline');
  });

  it('chạy lại idempotent — không duplicate version', async () => {
    await runMigrations(db as never);
    await runMigrations(db as never);
    const r = await db.query('SELECT COUNT(*)::int AS c FROM schema_migrations WHERE version = $1', [SCHEMA_VERSION]);
    assert.equal((r.rows[0] as { c: number }).c, 1);
  });
});
