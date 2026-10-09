/**
 * Test tính toàn vẹn của schema enterprise trên PostgreSQL:
 * - Mọi bảng/cột/FK/trigger/view đúng như thiết kế (validateSchema)
 * - CHECK constraint từ chối dữ liệu bẩn (enum sai, tiền âm, rating vượt thang)
 * - FK thực sự có hiệu lực: chặn mồ côi, cascade xóa đúng chính sách
 * - Trigger tự chạm updated_at
 * - Data dictionary bao phủ 100% bảng
 */
// LƯU Ý: Chạy test với DATABASE_URL trỏ tới test DB:
//   DATABASE_URL=postgres://educenter:educenter123@localhost:5432/educenter_test node --test ...
// (pg-compat đọc DATABASE_URL lúc load module — không set trong file vì ES module hoist imports)

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { validateSchema, TABLE_DOCS, SCHEMA_VERSION } from './schema';
import { setupTestDb, resetTestDb, teardownTestDb } from './test-utils';

describe('schema enterprise (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('SCHEMA_VERSION khớp migration mới nhất', async () => {
    const r = await db.query('SELECT MAX(version) as v FROM schema_migrations');
    assert.equal((r.rows[0] as { v: number }).v, SCHEMA_VERSION);
  });

  it('validateSchema() đạt — đủ bảng, đủ FK, đủ trigger, đủ view, không mồ côi', async () => {
    await validateSchema(db); // ném Error nếu lệch chuẩn
  });

  it('data dictionary bao phủ 100% bảng trong DB', async () => {
    const r = await db.query(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations'`
    );
    const tables = (r.rows as { name: string }[]).map((x) => x.name);
    for (const t of tables) {
      assert.ok(TABLE_DOCS[t], `Bảng ${t} thiếu tài liệu trong TABLE_DOCS`);
      const cr = await db.query(
        `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [t]
      );
      const cols = (cr.rows as { name: string }[]).map((c) => c.name);
      for (const c of cols) {
        assert.ok(TABLE_DOCS[t].columns[c], `Cột ${t}.${c} thiếu tài liệu`);
      }
    }
  });

  it('CHECK từ chối enum sai và dữ liệu bẩn', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run();
    const centerId = Number(cr.lastInsertRowid);
    // role sai
    await assert.rejects(() =>
      db.prepare("INSERT INTO users (username, password_hash, role, name) VALUES ('u1','x','hacker','X')").run()
    );
    // status học viên sai
    await assert.rejects(() =>
      db.prepare('INSERT INTO students (code, name, status, center_id) VALUES (?,?,?,?)').run('HV1', 'A', 'bogus', centerId)
    );
    // tiền hóa đơn âm
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HV2', 'B', centerId);
    const stId = Number(sr.lastInsertRowid);
    await assert.rejects(() =>
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, -1000, centerId)
    );
    // rating vượt thang 1-5
    await assert.rejects(() => db.prepare('INSERT INTO reviews (center_id, rating) VALUES (?,?)').run(centerId, 9));
    // điểm vượt max_score
    await assert.rejects(() =>
      db.prepare('INSERT INTO grades (student_id, title, score, max_score) VALUES (?,?,?,?)').run(stId, 'KT', 11, 10)
    );
    // plan sai
    await assert.rejects(() => db.prepare("INSERT INTO centers (name, plan) VALUES ('X','vip')").run());
    // ngày nghỉ ngược
    await assert.rejects(() =>
      db.prepare('INSERT INTO leave_requests (student_id, from_date, to_date) VALUES (?,?,?)').run(stId, '2026-10-10', '2026-10-01')
    );
  });

  it('FK chặn bản ghi mồ côi', async () => {
    await assert.rejects(() => db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(999999, 1000));
    await assert.rejects(() => db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?,?)').run(999999, 999999));
  });

  it('ON DELETE CASCADE xóa đúng chính sách', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT2')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVX', 'X', centerId);
    const stId = Number(sr.lastInsertRowid);
    const clr = await db.prepare('INSERT INTO classes (name, center_id) VALUES (?,?)').run('LopX', centerId);
    const clId = Number(clr.lastInsertRowid);
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?,?)').run(stId, clId);
    const ser = await db.prepare('INSERT INTO sessions (class_id, date) VALUES (?,?)').run(clId, '2026-10-09');
    const seId = Number(ser.lastInsertRowid);
    await db.prepare('INSERT INTO attendance (session_id, student_id) VALUES (?,?)').run(seId, stId);
    const ir = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000, centerId);
    const inId = Number(ir.lastInsertRowid);
    await db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(inId, 1000);

    await db.prepare('DELETE FROM students WHERE id = ?').run(stId);

    const count = async (t: string) => ((await db.query(`SELECT COUNT(*)::int as c FROM ${t}`)).rows[0] as { c: number }).c;
    assert.equal(await count('enrollments'), 0);
    assert.equal(await count('attendance'), 0);
    assert.equal(await count('invoices'), 0);
    assert.equal(await count('payments'), 0);
    // sessions thuộc về lớp — phải còn
    assert.equal(await count('sessions'), 1);
  });

  it('ON DELETE RESTRICT chặn xóa trung tâm còn dữ liệu', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT3')").run();
    const centerId = Number(cr.lastInsertRowid);
    await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVY', 'Y', centerId);
    await assert.rejects(() => db.prepare('DELETE FROM centers WHERE id = ?').run(centerId));
  });

  it('ON DELETE SET NULL giữ lịch sử khi xóa tham chiếu tùy chọn', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT4')").run();
    const centerId = Number(cr.lastInsertRowid);
    const tr = await db.prepare('INSERT INTO teachers (name, center_id) VALUES (?,?)').run('GV', centerId);
    const tId = Number(tr.lastInsertRowid);
    const clr = await db.prepare('INSERT INTO classes (name, center_id, teacher_id) VALUES (?,?,?)').run('LopY', centerId, tId);
    const clId = Number(clr.lastInsertRowid);
    await db.prepare('DELETE FROM teachers WHERE id = ?').run(tId);
    const row = (await db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(clId)) as { teacher_id: number | null };
    assert.equal(row.teacher_id, null);
  });

  it('trigger tự chạm updated_at khi UPDATE', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT5')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVZ', 'Z', centerId);
    const stId = Number(sr.lastInsertRowid);
    await db.exec(`UPDATE students SET updated_at = '2000-01-01 00:00:00' WHERE id = ${stId}`);
    // UPDATE không đụng updated_at -> trigger phải tự chạm
    await db.prepare('UPDATE students SET note = ? WHERE id = ?').run('ghi chú', stId);
    const row = (await db.prepare('SELECT updated_at FROM students WHERE id = ?').get(stId)) as { updated_at: string };
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
  });

  it('view v_invoice_balance tính đúng công nợ', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT6')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVW', 'W', centerId);
    const stId = Number(sr.lastInsertRowid);
    const ir = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000000, centerId);
    const inId = Number(ir.lastInsertRowid);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'confirmed')").run(inId, 400000);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'pending')").run(inId, 900000);
    const row = (await db.prepare('SELECT paid_confirmed, balance FROM v_invoice_balance WHERE invoice_id = ?').get(inId)) as {
      paid_confirmed: number;
      balance: number;
    };
    assert.equal(Number(row.paid_confirmed), 400000); // pending không tính
    assert.equal(Number(row.balance), 600000);
  });

  it('audit_logs cố tình không có FK (bất tử)', async () => {
    const r = await db.query(
      `SELECT COUNT(*)::int AS c FROM pg_constraint WHERE conrelid = 'audit_logs'::regclass AND contype = 'f'`
    );
    assert.equal((r.rows[0] as { c: number }).c, 0);
    // vẫn ghi log được cho entity đã bị xóa
    await db.prepare('INSERT INTO audit_logs (action, entity, entity_id, summary) VALUES (?,?,?,?)').run(
      'student.delete', 'student', 999999, 'Xóa học viên'
    );
  });

  it('payment_history/invoice_history ghi lại mọi INSERT/UPDATE/DELETE (bất biến)', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TTH')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVH', 'H', centerId);
    const stId = Number(sr.lastInsertRowid);
    const ir = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000000, centerId);
    const inId = Number(ir.lastInsertRowid);
    const pr = await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'pending')").run(inId, 500000);
    const pId = Number(pr.lastInsertRowid);

    // insert đã được ghi
    let h = (await db.prepare('SELECT action FROM payment_history WHERE payment_id = ?').all(pId)) as { action: string }[];
    assert.deepEqual(h.map((x) => x.action), ['insert']);
    const ih = (await db.prepare('SELECT action FROM invoice_history WHERE invoice_id = ?').all(inId)) as { action: string }[];
    assert.deepEqual(ih.map((x) => x.action), ['insert']);

    // update: đổi trạng thái payment + sửa hóa đơn
    await db.prepare("UPDATE payments SET status = 'confirmed' WHERE id = ?").run(pId);
    await db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(inId);
    const h2 = (await db.prepare('SELECT action, old_data, new_data FROM payment_history WHERE payment_id = ? ORDER BY id').all(pId)) as {
      action: string; old_data?: string | null; new_data?: string | null;
    }[];
    assert.equal(h2.length, 2);
    assert.equal(h2[1].action, 'update');
    assert.match(h2[1].old_data as string, /"status"\s*:\s*"pending"/);
    assert.match(h2[1].new_data as string, /"status"\s*:\s*"confirmed"/);

    // delete payment: dấu vết còn lại dù payment đã mất
    await db.prepare('DELETE FROM payments WHERE id = ?').run(pId);
    h = (await db.prepare('SELECT action FROM payment_history WHERE payment_id = ? ORDER BY id').all(pId)) as { action: string }[];
    assert.deepEqual(h.map((x) => x.action), ['insert', 'update', 'delete']);
    const cnt = (await db.query('SELECT COUNT(*)::int as c FROM payments WHERE id = $1', [pId])).rows[0] as { c: number };
    assert.equal(cnt.c, 0);
  });

  it('version tăng tự động mỗi lần UPDATE (optimistic locking)', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TTV')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVV', 'V', centerId);
    const stId = Number(sr.lastInsertRowid);
    const get = async () =>
      ((await db.prepare('SELECT version FROM students WHERE id = ?').get(stId)) as { version: number }).version;
    assert.equal(await get(), 0);
    await db.prepare('UPDATE students SET note = ? WHERE id = ?').run('a', stId);
    assert.equal(await get(), 1);
    await db.prepare('UPDATE students SET note = ? WHERE id = ?').run('b', stId);
    assert.equal(await get(), 2);
    // app tự set version (dùng optimistic locking) thì trigger không ghi đè
    await db.prepare('UPDATE students SET note = ?, version = ? WHERE id = ?').run('c', 10, stId);
    assert.equal(await get(), 10);
  });

  it('updated_at phủ mọi bảng mutable (vd: payments, reminders)', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TTU')").run();
    const centerId = Number(cr.lastInsertRowid);
    const sr = await db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HVU', 'U', centerId);
    const stId = Number(sr.lastInsertRowid);
    const ir = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(stId, 1000, centerId);
    const inId = Number(ir.lastInsertRowid);
    const pr = await db.prepare('INSERT INTO payments (invoice_id, amount) VALUES (?,?)').run(inId, 1000);
    const pId = Number(pr.lastInsertRowid);
    await db.exec(`UPDATE payments SET updated_at = '2000-01-01 00:00:00' WHERE id = ${pId}`);
    await db.prepare("UPDATE payments SET status = 'confirmed' WHERE id = ?").run(pId);
    const row = (await db.prepare('SELECT updated_at FROM payments WHERE id = ?').get(pId)) as { updated_at: string };
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
  });
});
