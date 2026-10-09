/**
 * Test bộ kiểm tra đối soát tài chính (db/consistency.ts) trên PostgreSQL:
 * - Phát hiện status hóa đơn bị lệch
 * - Phát hiện thu vượt
 * - Phát hiện payment mồ côi / số tiền bất thường
 * - DB sạch thì không báo gì
 */
// LƯU Ý: Chạy test với DATABASE_URL trỏ tới test DB:
//   DATABASE_URL=postgres://educenter:educenter123@localhost:5432/educenter_test node --test ...
// (pg-compat đọc DATABASE_URL lúc load module — không set trong file vì ES module hoist imports)

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
    const r = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)').run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')").run(inId, 400000);
    await db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(inId);
    assert.deepEqual(await checkFinancialConsistency(db), []);
  });

  it('phát hiện status hóa đơn bị lệch', async () => {
    const r = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)').run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')").run(inId, 1000000);
    // cố tình không recalc -> status vẫn unpaid trong khi đã thu đủ
    const issues = await checkFinancialConsistency(db);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'invoice_status_drift');
    assert.equal(issues[0].invoice_id, inId);
  });

  it('phát hiện thu vượt và payment mồ côi', async () => {
    const r = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)').run(studentId, 500000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'confirmed')").run(inId, 700000);
    // payment mồ côi: dùng session_replication_role để bypass FK (mô phỏng DB cũ trước thời FK)
    await db.exec('SET session_replication_role = replica');
    try {
      await db.prepare('INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, ?)').run(999999, 100000, 'confirmed');
    } finally {
      await db.exec('SET session_replication_role = DEFAULT');
    }
    const issues = await checkFinancialConsistency(db);
    const codes = issues.map((i) => i.code).sort();
    assert.ok(codes.includes('overpaid_invoice'), `thiếu overpaid: ${codes}`);
    assert.ok(codes.includes('orphan_payment'), `thiếu orphan: ${codes}`);
  });

  it('payment pending không tính vào công nợ nên không báo drift', async () => {
    const r = await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)').run(studentId, 1000000, centerId);
    const inId = Number(r.lastInsertRowid);
    await db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?, ?, 'pending')").run(inId, 1000000);
    assert.deepEqual(await checkFinancialConsistency(db), []);
  });
});
