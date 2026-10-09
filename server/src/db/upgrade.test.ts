/**
 * Test đường nâng cấp DB CŨ (được tạo trước bản schema enterprise):
 * - Bảng cũ thiếu cột updated_at/version vẫn nâng cấp được (v5/v6)
 * - Backfill timestamp cho dữ liệu cũ
 * - Trigger + history tables hoạt động trên bảng cũ
 *
 * Đây là regression test cho bug "Cannot add a column with non-constant default"
 * (ALTER TABLE ADD COLUMN cấm default datetime('now')).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

declare const require: NodeRequire;

const { createSchema, createTriggers, createHistoryTables, createViews } =
  require('./schema') as typeof import('./schema');
const { runMigrations } = require('./migrations') as typeof import('./migrations');
const { runVersionedMigrations } = require('./versionedMigrations') as typeof import('./versionedMigrations');
const { createIndexes } = require('./indexes') as typeof import('./indexes');

/** Dựng DB "cũ" — 5 bảng với ĐÚNG định dạng trước bản enterprise (lấy từ git f1dd356). */
function oldDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subdomain TEXT UNIQUE,
      phone TEXT,
      address TEXT,
      plan TEXT NOT NULL DEFAULT 'standard',
      plan_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      dob TEXT,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'studying',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      center_id INTEGER,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 30
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER,
      amount REAL NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'unpaid',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      paid_at TEXT NOT NULL DEFAULT (datetime('now')),
      method TEXT,
      note TEXT
    );
  `);
  // dữ liệu cũ tồn tại trước khi nâng cấp
  const c = db.prepare("INSERT INTO centers (name) VALUES ('Cũ')").run().lastInsertRowid;
  const s = db.prepare("INSERT INTO students (code, name) VALUES ('HV0','Cũ')").run().lastInsertRowid;
  db.prepare('INSERT INTO rooms (name) VALUES (?)').run('P.Cũ');
  const i = db.prepare('INSERT INTO invoices (student_id, amount) VALUES (?,?)').run(s, 100000).lastInsertRowid;
  db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(i, 100000);
  return { db, ids: { c, s, i } };
}

/** Chạy toàn bộ pipeline khởi tạo như db/index.ts (production). */
function fullInit(db: ReturnType<typeof oldDb>['db']) {
  createSchema(db);
  runMigrations(db);
  runVersionedMigrations(db);
  createIndexes(db);
  createTriggers(db);
  createHistoryTables(db);
  createViews(db);
}

describe('nâng cấp DB cũ', () => {
  it('v5/v6 backfill updated_at + version, không crash', () => {
    const { db, ids } = oldDb();
    fullInit(db);

    const mig = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
    assert.equal(mig.v, 6);

    // cột mới tồn tại và dữ liệu cũ được backfill timestamp
    for (const t of ['rooms', 'payments']) {
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      assert.ok(cols.includes('updated_at'), `${t} thiếu updated_at sau nâng cấp`);
    }
    const r = db.prepare('SELECT updated_at FROM rooms LIMIT 1').get() as { updated_at: string };
    assert.ok(r.updated_at && r.updated_at !== '', 'dữ liệu cũ phải được backfill updated_at');

    const scols = (db.prepare('PRAGMA table_info(students)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(scols.includes('version'), 'students thiếu version sau nâng cấp');
    const sv = db.prepare('SELECT version FROM students WHERE id = ?').get(ids.s) as { version: number };
    assert.equal(sv.version, 0);
  });

  it('trigger maintain + history hoạt động trên bảng cũ', () => {
    const { db, ids } = oldDb();
    fullInit(db);

    // update trên bảng cũ -> updated_at tự chạm, version tăng
    db.prepare('UPDATE rooms SET name = ? WHERE id = 1').run('P.Mới');
    const r = db.prepare('SELECT updated_at FROM rooms WHERE id = 1').get() as { updated_at: string };
    assert.ok(r.updated_at && r.updated_at.length > 0);

    // history ghi nhận thay đổi payment trên bảng cũ
    const p = db.prepare('SELECT id FROM payments LIMIT 1').get() as { id: number };
    db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(p.id);
    const h = db.prepare('SELECT action FROM payment_history WHERE payment_id = ?').all(p.id) as {
      action: string;
    }[];
    assert.ok(h.some((x) => x.action === 'update'), 'thiếu history update');

    // bảng cũ giữ nguyên dữ liệu
    const inv = db.prepare('SELECT amount, status FROM invoices WHERE id = ?').get(ids.i) as {
      amount: number;
      status: string;
    };
    assert.equal(inv.amount, 100000);
    assert.equal(inv.status, 'unpaid');
  });

  it('chạy nâng cấp 2 lần vẫn an toàn (idempotent)', () => {
    const { db } = oldDb();
    fullInit(db);
    fullInit(db); // chạy lại
    const mig = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
    assert.equal(mig.v, 6);
    // LƯU Ý: DB cũ giữ nguyên định nghĩa bảng cũ (thiếu FK/CHECK) — SQLite không
    // ALTER để thêm ràng buộc vào bảng đã tồn tại. Chỉ DB cài mới đạt validateSchema
    // đầy đủ. Ở đây kiểm tra cột mới vẫn còn sau 2 lần chạy:
    const cols = (db.prepare('PRAGMA table_info(rooms)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes('updated_at'));
  });
});
