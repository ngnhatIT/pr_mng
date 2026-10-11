/**
 * Test migration PostgreSQL (db/migrations.ts):
 * - schema_migrations được tạo, ghi baseline + các migration v2..v4
 * - Migration v2 mở rộng được reminder kinds (vd: 'homework')
 * - Migration v3 tạo unique index parent_reviews_unique
 * - Chạy lại idempotent (không duplicate, không lỗi)
 * - Fail-fast khi DB version lớn hơn code
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module (DATA-8:
// không để `db` rơi về DATABASE_URL thật trong server/.env khi chạy lẻ file này).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { runMigrations, MIGRATIONS, bootDdlDb } from './migrations';
import { createSchema, createTriggers, createHistoryTables, createViews } from './schema';
import { createIndexes } from './indexes';
import { Client } from 'pg';
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
    // v14 đổi tên thành parent_reviews_unique_full (drop partial cũ) — test bám theo tên mới
    const r = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'parent_reviews_unique_full'`
    );
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

  it('J-A3: bảng bị transaction khác giữ lock -> migration hết lock_timeout, lỗi rõ ràng, rollback; thả lock thì chạy được', async () => {
    const v24 = MIGRATIONS.find((m) => m.version === 24)!;
    await db.transaction(async (tx) => {
      await v24.down!(tx);
      await tx.exec('DELETE FROM schema_migrations WHERE version = 24');
    });
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    const prev = process.env.MIGRATION_LOCK_TIMEOUT;
    process.env.MIGRATION_LOCK_TIMEOUT = '300ms';
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE homework IN ACCESS SHARE MODE'); // vd một báo cáo dài đang đọc
      await assert.rejects(() => runMigrations(db as never), /v24 .*không lấy được lock bảng/);
      const has = await db.query('SELECT 1 FROM schema_migrations WHERE version = 24');
      assert.equal(has.rows.length, 0, 'migration lỗi phải rollback, chưa ghi nhận');
      await holder.query('COMMIT');
      await runMigrations(db as never);
      assert.equal((await db.query('SELECT 1 FROM schema_migrations WHERE version = 24')).rows.length, 1);
    } finally {
      if (prev === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT;
      else process.env.MIGRATION_LOCK_TIMEOUT = prev;
      await holder.end();
    }
  });

  it('N-2: DDL lúc boot không xin lock bảng khi đã đủ; thiếu index + bảng bị giữ -> lock_timeout, lỗi rõ, rollback', async () => {
    const bootDdl = async () => {
      const ddl = bootDdlDb(db as never);
      await createSchema(ddl);
      await createIndexes(ddl);
      await createTriggers(ddl);
      await createHistoryTables(ddl);
      await createViews(ddl);
    };
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    const prev = process.env.MIGRATION_LOCK_TIMEOUT;
    process.env.MIGRATION_LOCK_TIMEOUT = '300ms';
    try {
      // Như kịch bản judge: transaction dài đang ghi payments (+ payment_history qua trigger)
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE payments, payment_history IN ROW EXCLUSIVE MODE');
      const t0 = Date.now();
      await bootDdl(); // đã đủ index/cột -> không câu nào cần lock bảng
      assert.ok(Date.now() - t0 < 5000);
      await holder.query('COMMIT');

      await db.exec('DROP INDEX idx_payments_paid_at');
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE payments IN ROW EXCLUSIVE MODE');
      await assert.rejects(bootDdl(), /DDL lúc khởi động: không lấy được lock bảng/);
      await holder.query('COMMIT');
      await bootDdl();
      const idx = await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_payments_paid_at'");
      assert.equal(idx.rows.length, 1, 'thả lock thì boot tạo lại index còn thiếu');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      if (prev === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT;
      else process.env.MIGRATION_LOCK_TIMEOUT = prev;
      await holder.end();
    }
  });

  describe('migration v19 - submissions unique (P1-6)', () => {
    it('up: gộp bản nộp trùng, giữ bản mới nhất + tạo unique', async () => {
      // Giả lập DB cũ: gỡ constraint rồi chèn dữ liệu trùng
      await db.exec('ALTER TABLE homework_submissions DROP CONSTRAINT IF EXISTS uq_submissions_hw_student');
      await db.exec('DROP INDEX IF EXISTS uq_submissions_hw_student');
      const ctr = Number(
        (await db.prepare("INSERT INTO centers (name) VALUES ('TT v19')").run()).lastInsertRowid
      );
      const u = await db
        .prepare(
          "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('u19', 'x', 'staff', 'U19', ?)"
        )
        .run(ctr);
      const c = await db.prepare("INSERT INTO classes (name, center_id) VALUES ('Lớp v19', ?)").run(ctr);
      const hw = await db
        .prepare('INSERT INTO homework (class_id, title, created_by) VALUES (?, ?, ?)')
        .run(Number(c.lastInsertRowid), 'T', Number(u.lastInsertRowid));
      const hwid = Number(hw.lastInsertRowid);
      const st = await db
        .prepare("INSERT INTO students (code, name, center_id) VALUES ('DUP1', 'Trùng', ?)")
        .run(ctr);
      const sid = Number(st.lastInsertRowid);
      await db
        .prepare('INSERT INTO homework_submissions (homework_id, student_id, note) VALUES (?, ?, ?)')
        .run(hwid, sid, 'bản cũ');
      await db
        .prepare('INSERT INTO homework_submissions (homework_id, student_id, note) VALUES (?, ?, ?)')
        .run(hwid, sid, 'bản mới nhất');
      // Chạy lại up của v19
      await db.query('DELETE FROM schema_migrations WHERE version = 19');
      await runMigrations(db as never);
      const rows = (await db
        .prepare('SELECT note FROM homework_submissions WHERE homework_id = ? AND student_id = ?')
        .all(hwid, sid)) as { note: string }[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].note, 'bản mới nhất'); // giữ bản mới nhất
      const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_submissions_hw_student'`);
      assert.equal(idx.rows.length, 1);
      // Insert trùng mới bị chặn ở tầng DB
      await assert.rejects(
        db.prepare('INSERT INTO homework_submissions (homework_id, student_id) VALUES (?, ?)').run(hwid, sid),
        /uq_submissions_hw_student|duplicate/
      );
    });

    it('down: gỡ unique, insert trùng lại được', async () => {
      const { MIGRATIONS } = await import('./migrations');
      const v19 = MIGRATIONS.find((m) => m.version === 19)!;
      assert.ok(v19.down, 'v19 phải có down');
      await db.transaction(async (tx) => {
        await v19.down!(tx as never);
      });
      const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_submissions_hw_student'`);
      assert.equal(idx.rows.length, 0);
      // Khôi phục lại up để các test khác không ảnh hưởng
      await db.query('DELETE FROM schema_migrations WHERE version = 19');
      await runMigrations(db as never);
    });
  });
});
