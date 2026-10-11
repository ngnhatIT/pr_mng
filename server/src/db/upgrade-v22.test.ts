/**
 * CI-2: nâng cấp DB cũ (shape v21, có dữ liệu thật) lên bản mới nhất.
 * DB test mới tạo đã có shape đích -> backfill của v22 chạy trên 0 dòng. Ở đây gỡ ngược
 * mọi migration >= 22 (down, từ mới về cũ), chèn dòng "legacy", rồi runMigrations tới LATEST
 * (không cố định version — migration sau v22 vẫn chạy qua) và kiểm tra backfill + NOT VALID.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
// Boot như production: không seed demo / không backfillCenters (sẽ gán center cho dòng cũ, che NOT VALID)
process.env.SEED_DEMO = 'false';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { MIGRATIONS, runMigrations } from './migrations';
import { initDatabase } from './index';
import { setupTestDb, teardownTestDb } from './test-utils';

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const one = async <T>(sql: string, ...p: unknown[]) => (await db.prepare(sql).get(...p)) as T;

describe('migration v22/v23 - nâng cấp DB cũ có dữ liệu qua boot thật (CI-2)', () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });

  it('down về v21 -> chèn dữ liệu cũ -> migrate tới latest: backfill + chk_users_center NOT VALID', async () => {
    // 1) Gỡ ngược về shape v21
    const newer = MIGRATIONS.filter((m) => m.version >= 22).sort((a, b) => b.version - a.version);
    await db.transaction(async (tx) => {
      for (const m of newer) {
        assert.ok(m.down, `migration v${m.version} cần down để test nâng cấp từ v21`);
        await m.down(tx);
      }
      await tx.exec('DELETE FROM schema_migrations WHERE version >= 22');
      // idempotency_keys shape cũ (PK chỉ theo key, không có user_key)
      await tx.exec('DROP TABLE IF EXISTS idempotency_keys');
      await tx.exec('CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, response TEXT)');
    });
    assert.equal(
      (
        await db.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'teacher_id'`
        )
      ).rows.length,
      0,
      'down chưa đưa về shape v21'
    );

    // 2) Dữ liệu cũ
    const c1 = await id("INSERT INTO centers (name) VALUES ('TT1')");
    const c2 = await id("INSERT INTO centers (name) VALUES ('TT2')");
    await id(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('staff1', 'x', 'staff', 'S', ?)",
      c1
    );
    // Non-superadmin không có trung tâm: dòng cũ phải được giữ (NOT VALID), không chặn boot
    const orphan = await id(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('oldadmin', 'x', 'admin', 'A', NULL)"
    );
    const p1 = await id(
      "INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, '0901', 'x', 'P1')",
      c1
    );
    // SĐT trùng ở 2 trung tâm -> mơ hồ, không backfill
    await id(
      "INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, '0902', 'x', 'P2a')",
      c1
    );
    await id(
      "INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, '0902', 'x', 'P2b')",
      c2
    );
    const rrStaff = await id("INSERT INTO reset_requests (identifier, kind) VALUES ('staff1', 'staff')");
    const rrParent = await id("INSERT INTO reset_requests (identifier, kind) VALUES ('0901', 'parent')");
    const rrAmbiguous = await id("INSERT INTO reset_requests (identifier, kind) VALUES ('0902', 'parent')");
    const ref = await id(
      'INSERT INTO referrals (referrer_parent_id, referred_phone) VALUES (?, ?)',
      p1,
      '0999'
    );
    const t1 = await id("INSERT INTO teachers (center_id, name) VALUES (?, 'GV lớp')", c1);
    const t2 = await id("INSERT INTO teachers (center_id, name) VALUES (?, 'GV dạy thay')", c1);
    const cls = await id("INSERT INTO classes (center_id, name, teacher_id) VALUES (?, 'L1', ?)", c1, t1);
    const sPlain = await id("INSERT INTO sessions (class_id, date) VALUES (?, '2026-01-01')", cls);
    const sSub = await id("INSERT INTO sessions (class_id, date) VALUES (?, '2026-01-02')", cls);
    await id('INSERT INTO teacher_checkins (session_id, teacher_id) VALUES (?, ?)', sSub, t2);
    await db.exec("INSERT INTO idempotency_keys (key, response) VALUES ('k1', '{}')");
    // v23: credit áp qua note, thưởng giới thiệu nhận theo reason, đơn giá lương chưa có lịch sử
    const st = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HV', ?)", c1);
    const invRefunded = await id(
      'INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 0, ?)',
      st,
      c1
    );
    const invPaid = await id(
      'INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 500000, ?)',
      st,
      c1
    );
    const reward = await id(
      'INSERT INTO credits (parent_id, amount, reason, center_id) VALUES (?, 200000, ?, ?)',
      p1,
      `Thưởng giới thiệu học viên mới (HD${invRefunded})`,
      c1
    );
    const promo = await id(
      "INSERT INTO credits (parent_id, amount, used_amount, reason, center_id) VALUES (?, 100000, 100000, 'KM', ?)",
      p1,
      c1
    );
    const creditPay = await id(
      "INSERT INTO payments (invoice_id, amount, method, note) VALUES (?, 100000, 'credit', ?)",
      invPaid,
      `Áp dụng credits #${promo}`
    );
    // J-A5: note nhân viên tự gõ 'credits #N' không được nối vào credit
    const otherCenterCredit = await id(
      "INSERT INTO credits (parent_id, amount, reason, center_id) VALUES (?, 1000, 'KM', ?)",
      p1,
      c2
    );
    const crossPay = await id(
      "INSERT INTO payments (invoice_id, amount, method, note) VALUES (?, 1000, 'credit', ?)",
      invPaid,
      `Áp dụng credits #${otherCenterCredit}`
    );
    const typedPay = await id(
      "INSERT INTO payments (invoice_id, amount, method, note) VALUES (?, 1000, 'credit', ?)",
      invPaid,
      `khach dung credits #${promo}`
    );
    await db.prepare('INSERT INTO salary_rules (teacher_id, per_session_amount) VALUES (?, 120000)').run(t1);

    // 3) Boot THẬT (initDatabase: createSchema -> migrations -> indexes -> ...). createSchema chạy trên
    //    shape cũ TRƯỚC migration: index/ALTER trên cột mới trong createSchema sẽ làm sập boot ở đây.
    await initDatabase();

    // 4) Backfill
    const centerOf = (table: string, rowId: number) =>
      one<{ center_id: number | null }>(`SELECT center_id FROM ${table} WHERE id = ?`, rowId);
    assert.equal((await centerOf('reset_requests', rrStaff)).center_id, c1);
    assert.equal((await centerOf('reset_requests', rrParent)).center_id, c1);
    assert.equal((await centerOf('reset_requests', rrAmbiguous)).center_id, null); // chỉ superadmin thấy
    assert.equal((await centerOf('referrals', ref)).center_id, c1);
    const tOf = async (sid: number) =>
      await one<{ teacher_id: number; status: string }>(
        'SELECT teacher_id, status FROM sessions WHERE id = ?',
        sid
      );
    assert.deepEqual({ ...(await tOf(sPlain)) }, { teacher_id: t1, status: 'scheduled' }); // GV của lớp
    assert.deepEqual({ ...(await tOf(sSub)) }, { teacher_id: t2, status: 'scheduled' }); // GV đã check-in

    // v23 backfill
    const rw = await one<{ source_invoice_id: number; voided_at: string | null; used_amount: number }>(
      'SELECT source_invoice_id, voided_at, used_amount FROM credits WHERE id = ?',
      reward
    );
    assert.equal(rw.source_invoice_id, invRefunded);
    assert.ok(rw.voided_at, 'thưởng của hóa đơn đã hoàn hết phải bị thu hồi');
    assert.equal(Number(rw.used_amount), 200000);
    assert.equal(
      (await one<{ credit_id: number }>('SELECT credit_id FROM payments WHERE id = ?', creditPay)).credit_id,
      promo
    );
    assert.equal(
      (await one<{ credit_id: number | null }>('SELECT credit_id FROM payments WHERE id = ?', typedPay))
        .credit_id,
      null
    );
    assert.equal(
      (await one<{ credit_id: number | null }>('SELECT credit_id FROM payments WHERE id = ?', crossPay))
        .credit_id,
      null,
      'credit khác trung tâm với hóa đơn không được nối'
    );
    const hist = await one<{ effective_from: string; per_session_amount: number }>(
      'SELECT effective_from, per_session_amount FROM salary_rate_history WHERE teacher_id = ?',
      t1
    );
    assert.deepEqual(
      { ...hist, per_session_amount: Number(hist.per_session_amount) },
      {
        effective_from: '1970-01-01',
        per_session_amount: 120000,
      }
    );
    const idxNames = new Set(
      (
        (await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows as {
          indexname: string;
        }[]
      ).map((r) => r.indexname)
    );
    for (const n of [
      'idx_txns_pending',
      'idx_txns_invoice',
      'idx_payments_credit',
      'idx_reset_requests_center',
    ])
      assert.ok(idxNames.has(n), `thiếu ${n}`);
    for (const n of ['idx_payments_invoice', 'idx_hw_submissions', 'idx_checkins_teacher'])
      assert.ok(!idxNames.has(n), `${n} phải bị bỏ (v23)`);

    // idempotency_keys cũ bị drop, tạo lại shape mới (PK user_key + key)
    const idem = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'idempotency_keys' AND column_name = 'user_key'`
    );
    assert.equal(idem.rows.length, 1);
    assert.equal((await one<{ n: number }>('SELECT COUNT(*) AS n FROM idempotency_keys')).n, 0);

    // 5) chk_users_center: tồn tại, NOT VALID, dòng cũ còn, dòng mới/sửa bị kiểm
    const con = await one<{ convalidated: boolean }>(
      "SELECT convalidated FROM pg_constraint WHERE conname = 'chk_users_center'"
    );
    assert.equal(con.convalidated, false);
    assert.ok(await one('SELECT 1 FROM users WHERE id = ?', orphan));
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, name) VALUES ('newadmin', 'x', 'admin', 'N')"
        )
        .run(),
      /chk_users_center/
    );
    await assert.rejects(
      db.prepare("UPDATE users SET name = 'A2' WHERE id = ?").run(orphan),
      /chk_users_center/
    );
    await id(
      "INSERT INTO users (username, password_hash, role, name) VALUES ('sa2', 'x', 'superadmin', 'SA')"
    );
    // Sửa dữ liệu cũ rồi VALIDATE được (quy trình vận hành)
    await db.prepare('UPDATE users SET center_id = ? WHERE id = ?').run(c1, orphan);
    await db.exec('ALTER TABLE users VALIDATE CONSTRAINT chk_users_center');

    // 6) Đã ở version mới nhất, chạy lại idempotent
    const max = await one<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations');
    assert.equal(max.v, Math.max(...MIGRATIONS.map((m) => m.version)));
    await runMigrations(db);
  });
});
