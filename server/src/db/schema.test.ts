/**
 * Test tính toàn vẹn của schema enterprise:
 * - Mọi bảng/cột/FK/trigger/view đúng như thiết kế (validateSchema)
 * - CHECK constraint từ chối dữ liệu bẩn (enum sai, tiền âm, rating vượt thang)
 * - FK thực sự có hiệu lực: chặn mồ côi, cascade xóa đúng chính sách
 * - Trigger tự chạm updated_at
 * - Data dictionary bao phủ 100% bảng
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

declare const require: NodeRequire;

const { createSchema, createTriggers, createHistoryTables, createViews, validateSchema, TABLE_DOCS, SCHEMA_VERSION } =
  require('./schema') as typeof import('./schema');
const { runMigrations } = require('./migrations') as typeof import('./migrations');
const { runVersionedMigrations } = require('./versionedMigrations') as typeof import('./versionedMigrations');
const { createIndexes } = require('./indexes') as typeof import('./indexes');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  runMigrations(db);
  runVersionedMigrations(db);
  createIndexes(db);
  createTriggers(db);
  createHistoryTables(db);
  createViews(db);
  return db;
}

describe('schema enterprise', () => {
  let db: ReturnType<typeof freshDb>;
  before(() => {
    db = freshDb();
  });

  it('SCHEMA_VERSION khớp migration mới nhất', () => {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
    assert.equal(row.v, SCHEMA_VERSION);
  });

  it('validateSchema() đạt — đủ bảng, đủ FK, đủ trigger, đủ view, không mồ côi', () => {
    validateSchema(db); // ném Error nếu lệch chuẩn
  });

  it('data dictionary bao phủ 100% bảng trong DB', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of tables) {
      assert.ok(TABLE_DOCS[t], `Bảng ${t} thiếu tài liệu trong TABLE_DOCS`);
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      for (const c of cols) {
        assert.ok(TABLE_DOCS[t].columns[c], `Cột ${t}.${c} thiếu tài liệu`);
      }
    }
  });

  it('CHECK từ chối enum sai và dữ liệu bẩn', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT')").run().lastInsertRowid);
    // role sai
    assert.throws(() =>
      db.prepare("INSERT INTO users (username, password_hash, role, name) VALUES ('u1','x','hacker','X')").run()
    );
    // status học viên sai
    assert.throws(() =>
      db.prepare('INSERT INTO students (code, name, status, center_id) VALUES (?,?,?,?)').run('HV1', 'A', 'bogus', centerId)
    );
    // tiền hóa đơn âm
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HV2', 'B', centerId).lastInsertRowid);
    assert.throws(() =>
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, -1000, centerId)
    );
    // rating vượt thang 1-5
    assert.throws(() =>
      db.prepare('INSERT INTO reviews (center_id, rating) VALUES (?,?)').run(centerId, 9)
    );
    // điểm vượt max_score
    assert.throws(() =>
      db.prepare('INSERT INTO grades (student_id, title, score, max_score) VALUES (?,?,?,?)').run(stId, 'KT', 11, 10)
    );
    // plan sai
    assert.throws(() => db.prepare("INSERT INTO centers (name, plan) VALUES ('X','vip')").run());
    // ngày nghỉ ngược
    assert.throws(() =>
      db.prepare('INSERT INTO leave_requests (student_id, from_date, to_date) VALUES (?,?,?)').run(stId, '2026-10-10', '2026-10-01')
    );
  });

  it('FK chặn bản ghi mồ côi', () => {
    assert.throws(() =>
      db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(999999, 1000)
    );
    assert.throws(() =>
      db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?,?)').run(999999, 999999)
    );
  });

  it('ON DELETE CASCADE xóa đúng chính sách (học viên -> ghi danh, điểm danh, hóa đơn, payment)', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT2')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVX', 'X', centerId).lastInsertRowid);
    const clId = Number(db.prepare('INSERT INTO classes (name, center_id) VALUES (?,?)').run('LopX', centerId).lastInsertRowid);
    db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?,?)').run(stId, clId);
    const seId = Number(db.prepare('INSERT INTO sessions (class_id, date) VALUES (?,?)').run(clId, '2026-10-09').lastInsertRowid);
    db.prepare('INSERT INTO attendance (session_id, student_id) VALUES (?,?)').run(seId, stId);
    const inId = Number(db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000, centerId).lastInsertRowid);
    db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(inId, 1000);

    db.prepare('DELETE FROM students WHERE id = ?').run(stId);

    const count = (t: string) => (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
    assert.equal(count('enrollments'), 0);
    assert.equal(count('attendance'), 0);
    assert.equal(count('invoices'), 0);
    assert.equal(count('payments'), 0);
    // sessions thuộc về lớp — phải còn
    assert.equal(count('sessions'), 1);
  });

  it('ON DELETE RESTRICT chặn xóa trung tâm còn dữ liệu', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT3')").run().lastInsertRowid);
    db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVY', 'Y', centerId);
    assert.throws(() => db.prepare('DELETE FROM centers WHERE id = ?').run(centerId));
  });

  it('ON DELETE SET NULL giữ lịch sử khi xóa tham chiếu tùy chọn', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT4')").run().lastInsertRowid);
    const tId = Number(db.prepare('INSERT INTO teachers (name, center_id) VALUES (?,?)').run('GV', centerId).lastInsertRowid);
    const clId = Number(db.prepare('INSERT INTO classes (name, center_id, teacher_id) VALUES (?,?,?)').run('LopY', centerId, tId).lastInsertRowid);
    db.prepare('DELETE FROM teachers WHERE id = ?').run(tId);
    const row = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(clId) as { teacher_id: number | null };
    assert.equal(row.teacher_id, null);
  });

  it('trigger tự chạm updated_at khi UPDATE', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT5')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVZ', 'Z', centerId).lastInsertRowid);
    db.exec("UPDATE students SET updated_at = '2000-01-01 00:00:00' WHERE id = " + stId);
    // UPDATE không đụng updated_at -> trigger phải tự chạm
    db.prepare('UPDATE students SET note = ? WHERE id = ?').run('ghi chú', stId);
    const row = db.prepare('SELECT updated_at FROM students WHERE id = ?').get(stId) as { updated_at: string };
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
  });

  it('view v_invoice_balance tính đúng công nợ', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT6')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVW', 'W', centerId).lastInsertRowid);
    const inId = Number(db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000000, centerId).lastInsertRowid);
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'confirmed')").run(inId, 400000);
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'pending')").run(inId, 900000);
    const row = db.prepare('SELECT paid_confirmed, balance FROM v_invoice_balance WHERE invoice_id = ?').get(inId) as {
      paid_confirmed: number;
      balance: number;
    };
    assert.equal(row.paid_confirmed, 400000); // pending không tính
    assert.equal(row.balance, 600000);
  });

  it('audit_logs cố tình không có FK (bất tử)', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(audit_logs)').all() as unknown[];
    assert.equal(fks.length, 0);
    // vẫn ghi log được cho entity đã bị xóa
    db.prepare('INSERT INTO audit_logs (action, entity, entity_id, summary) VALUES (?,?,?,?)').run(
      'student.delete', 'student', 999999, 'Xóa học viên'
    );
  });

  it('payment_history/invoice_history ghi lại mọi INSERT/UPDATE/DELETE (bất biến)', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TTH')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVH', 'H', centerId).lastInsertRowid);
    const inId = Number(db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000000, centerId).lastInsertRowid);
    const pId = Number(db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'pending')").run(inId, 500000).lastInsertRowid);

    // insert đã được ghi
    let h = db.prepare('SELECT action FROM payment_history WHERE payment_id = ?').all(pId) as {
      action: string; old_data?: string | null; new_data?: string | null;
    }[];
    assert.deepEqual(h.map((x) => x.action), ['insert']);
    const ih = db.prepare('SELECT action FROM invoice_history WHERE invoice_id = ?').all(inId) as { action: string }[];
    assert.deepEqual(ih.map((x) => x.action), ['insert']);

    // update: đổi trạng thái payment + sửa hóa đơn
    db.prepare("UPDATE payments SET status = 'confirmed' WHERE id = ?").run(pId);
    db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(inId);
    h = db.prepare('SELECT action, old_data, new_data FROM payment_history WHERE payment_id = ? ORDER BY id').all(pId) as {
      action: string; old_data?: string | null; new_data?: string | null;
    }[];
    assert.equal(h.length, 2);
    assert.equal(h[1].action, 'update');
    assert.match(h[1].old_data as string, /"status":"pending"/);
    assert.match(h[1].new_data as string, /"status":"confirmed"/);

    // delete payment: dấu vết còn lại dù payment đã mất
    db.prepare('DELETE FROM payments WHERE id = ?').run(pId);
    h = db.prepare('SELECT action FROM payment_history WHERE payment_id = ? ORDER BY id').all(pId) as { action: string }[];
    assert.deepEqual(h.map((x) => x.action), ['insert', 'update', 'delete']);
    assert.equal((db.prepare('SELECT COUNT(*) as c FROM payments WHERE id = ?').get(pId) as { c: number }).c, 0);
  });

  it('version tăng tự động mỗi lần UPDATE (optimistic locking)', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TTV')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVV', 'V', centerId).lastInsertRowid);
    const get = () => (db.prepare('SELECT version FROM students WHERE id = ?').get(stId) as { version: number }).version;
    assert.equal(get(), 0);
    db.prepare('UPDATE students SET note = ? WHERE id = ?').run('a', stId);
    assert.equal(get(), 1);
    db.prepare('UPDATE students SET note = ? WHERE id = ?').run('b', stId);
    assert.equal(get(), 2);
    // app tự set version (dùng optimistic locking) thì trigger không ghi đè
    db.prepare('UPDATE students SET note = ?, version = ? WHERE id = ?').run('c', 10, stId);
    assert.equal(get(), 10);
  });

  it('updated_at phủ mọi bảng mutable (vd: payments, reminders)', () => {
    const centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TTU')").run().lastInsertRowid);
    const stId = Number(db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVU', 'U', centerId).lastInsertRowid);
    const inId = Number(db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000, centerId).lastInsertRowid);
    const pId = Number(db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(inId, 1000).lastInsertRowid);
    db.exec(`UPDATE payments SET updated_at = '2000-01-01 00:00:00' WHERE id = ${pId}`);
    db.prepare("UPDATE payments SET status = 'confirmed' WHERE id = ?").run(pId);
    const row = db.prepare('SELECT updated_at FROM payments WHERE id = ?').get(pId) as { updated_at: string };
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
  });
});
