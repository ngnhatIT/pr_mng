/**
 * Test bộ kiểm tra đối soát tài chính (db/consistency.ts) trên PostgreSQL:
 * - Phát hiện status hóa đơn bị lệch
 * - Phát hiện thu vượt
 * - Phát hiện payment mồ côi / số tiền bất thường
 * - DB sạch thì không báo gì
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module (DATA-8:
// không để `db` rơi về DATABASE_URL thật trong server/.env khi chạy lẻ file này).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { checkFinancialConsistency } from './consistency';
import { setupTestDb, resetTestDb, teardownTestDb, seedMinimal } from './test-utils';

describe('checkFinancialConsistency (PostgreSQL)', () => {
  let centerId: number;
  let studentId: number;

  before(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    ({ centerId, studentId } = await seedMinimal());
  });

  after(async () => {
    await teardownTestDb();
  });

  it('DB sạch thì không có issue', async () => {
    const r = await db
      .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)')
      .run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db
      .prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')")
      .run(inId, 400000);
    await db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(inId);
    assert.deepEqual(await checkFinancialConsistency(db), []);
  });

  it('phát hiện status hóa đơn bị lệch', async () => {
    const r = await db
      .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)')
      .run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db
      .prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')")
      .run(inId, 1000000);
    // cố tình không recalc -> status vẫn unpaid trong khi đã thu đủ
    const issues = await checkFinancialConsistency(db);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'invoice_status_drift');
    assert.equal(issues[0].invoice_id, inId);
  });

  it('phát hiện thu vượt và payment mồ côi', async () => {
    const r = await db
      .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)')
      .run(studentId, 500000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db
      .prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')")
      .run(inId, 700000);
    // payment mồ côi: dùng session_replication_role để bypass FK (mô phỏng DB cũ trước thời FK)
    await db.exec('SET session_replication_role = replica');
    try {
      await db
        .prepare('INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, ?)')
        .run(999999, 100000, 'confirmed');
    } finally {
      await db.exec('SET session_replication_role = DEFAULT');
    }
    const issues = await checkFinancialConsistency(db);
    const codes = issues.map((i) => i.code).sort();
    assert.ok(codes.includes('overpaid_invoice'), `thiếu overpaid: ${codes}`);
    assert.ok(codes.includes('orphan_payment'), `thiếu orphan: ${codes}`);
  });

  it('payment pending không tính vào công nợ nên không báo drift', async () => {
    const r = await db
      .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)')
      .run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db
      .prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'pending')")
      .run(inId, 1000000);
    assert.deepEqual(await checkFinancialConsistency(db), []);
  });

  it('J-A5: payment credit đã duyệt không gắn credit_id bị báo credit_payment_unlinked', async () => {
    const inv = Number(
      (
        await db
          .prepare("INSERT INTO invoices (student_id, amount, center_id, status) VALUES (?, 100, ?, 'paid')")
          .run(studentId, centerId)
      ).lastInsertRowid
    );
    await db
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, 100, 'credit', 'credits #57', 'confirmed')"
      )
      .run(inv);
    assert.deepEqual(
      (await checkFinancialConsistency(db)).map((i) => i.code),
      ['credit_payment_unlinked']
    );
  });

  it('OPS-1: user không phải superadmin mà center_id NULL bị báo user_without_center', async () => {
    // Giả lập DB cũ trước v22 (chk_users_center chưa validate/chưa tồn tại).
    await db.exec('ALTER TABLE users DROP CONSTRAINT chk_users_center');
    try {
      await db.exec(
        "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('mo_coi', 'x', 'admin', 'Mồ côi', NULL)"
      );
      const issues = await checkFinancialConsistency(db);
      assert.deepEqual(
        issues.map((i) => i.code),
        ['user_without_center']
      );
    } finally {
      await db.exec("DELETE FROM users WHERE username = 'mo_coi'");
      await db.exec(
        "ALTER TABLE users ADD CONSTRAINT chk_users_center CHECK (role = 'superadmin' OR center_id IS NOT NULL)"
      );
    }
  });
  it('N6-1: custom role trung tâm A gán cho user trung tâm B bị báo role_cross_center', async () => {
    const b = (
      (await db.prepare("INSERT INTO centers (name) VALUES ('B') RETURNING id").get()) as { id: number }
    ).id;
    const u = (await db
      .prepare(
        "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('nvb', 'x', 'staff', 'NV B', ?) RETURNING id"
      )
      .get(b)) as { id: number };
    const r = (await db
      .prepare("INSERT INTO roles (code, name, center_id) VALUES ('rA', 'rA', ?) RETURNING id")
      .get(centerId)) as { id: number };
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(u.id, r.id);
    const issues = await checkFinancialConsistency(db);
    assert.deepEqual(
      issues.filter((i) => i.code === 'role_cross_center').map((i) => i.user_id),
      [u.id]
    );
  });
});
