/**
 * Test migration PostgreSQL (db/migrations.ts):
 * - schema_migrations được tạo, ghi baseline + các migration v2..v4
 * - Migration v2 mở rộng được reminder kinds (vd: 'homework')
 * - Migration v3 tạo unique index parent_reviews_unique
 * - Chạy lại idempotent (không duplicate, không lỗi)
 * - Fail-fast khi DB version lớn hơn code
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

describe('migrations PostgreSQL', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('SCHEMA_VERSION = 1 cho baseline PostgreSQL', () => {
    assert.equal(SCHEMA_VERSION, 1);
  });

  it('ghi baseline + chạy các migration v2..v4', async () => {
    const r = await db.query('SELECT version, name FROM schema_migrations ORDER BY version');
    const rows = r.rows as { version: number; name: string }[];
    const byVersion = new Map(rows.map((x) => [x.version, x.name]));
    assert.equal(byVersion.get(SCHEMA_VERSION), 'pg_baseline');
    assert.equal(byVersion.get(2), 'reminder_kinds');
    assert.equal(byVersion.get(3), 'reviews_parent_unique');
    assert.equal(byVersion.get(4), 'history_changed_by');
  });

  it('migration v2: reminder kind mới insert được, kind lạ bị chặn', async () => {
    await db.prepare(`INSERT INTO reminders (kind, status) VALUES ('homework', 'sent')`).run();
    await db.prepare(`INSERT INTO reminders (kind, status) VALUES ('leave_result', 'sent')`).run();
    await assert.rejects(
      db.prepare(`INSERT INTO reminders (kind, status) VALUES ('bogus_kind', 'sent')`).run(),
      /chk_reminders_kind/
    );
  });

  it('migration v3: tồn tại unique index parent_reviews_unique', async () => {
    const r = await db.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'parent_reviews_unique'`);
    assert.equal(r.rows.length, 1);
  });

  it('migration v4: cột changed_by tồn tại trên 2 bảng history', async () => {
    for (const t of ['payment_history', 'invoice_history']) {
      const r = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'changed_by'`,
        [t]
      );
      assert.equal(r.rows.length, 1, `thiếu cột changed_by ở ${t}`);
    }
  });

  it('chạy lại idempotent — không duplicate version', async () => {
    await runMigrations(db as never);
    await runMigrations(db as never);
    const r = await db.query('SELECT version FROM schema_migrations GROUP BY version HAVING COUNT(*) > 1');
    assert.equal(r.rows.length, 0);
  });

  it('fail-fast khi DB version lớn hơn code', async () => {
    await db.query(
      `INSERT INTO schema_migrations (version, name) VALUES (999, 'future') ON CONFLICT DO NOTHING`
    );
    await assert.rejects(() => runMigrations(db as never), /mới hơn code/);
    await db.query('DELETE FROM schema_migrations WHERE version = 999');
  });
});
