/**
 * Test bộ kiểm tra đối soát tài chính (db/consistency.ts):
 * - Phát hiện status hóa đơn bị lệch
 * - Phát hiện thu vượt
 * - Phát hiện payment mồ côi / số tiền bất thường
 * - DB sạch thì không báo gì
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

declare const require: NodeRequire;

const { createSchema } = require('./schema') as typeof import('./schema');
const { checkFinancialConsistency } = require('./consistency') as typeof import('./consistency');

function freshDb() {
  const db = new Database(':memory:');
  createSchema(db);
  return db;
}

describe('checkFinancialConsistency', () => {
  let db: ReturnType<typeof freshDb>;
  let centerId: number;
  let studentId: number;

  beforeEach(() => {
    db = freshDb();
    centerId = Number(db.prepare("INSERT INTO centers (name) VALUES ('TT')").run().lastInsertRowid);
    studentId = Number(
      db.prepare('INSERT INTO students (code, name, center_id) VALUES (?,?,?)').run('HV1', 'A', centerId).lastInsertRowid
    );
  });

  it('DB sạch thì không có issue', () => {
    const inId = Number(
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(studentId, 1000000, centerId)
        .lastInsertRowid
    );
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'confirmed')").run(inId, 400000);
    db.prepare("UPDATE invoices SET status = 'partial' WHERE id = ?").run(inId);
    assert.deepEqual(checkFinancialConsistency(db), []);
  });

  it('phát hiện status hóa đơn bị lệch', () => {
    const inId = Number(
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(studentId, 1000000, centerId)
        .lastInsertRowid
    );
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'confirmed')").run(inId, 1000000);
    // cố tình không recalc -> status vẫn unpaid trong khi đã thu đủ
    const issues = checkFinancialConsistency(db);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'invoice_status_drift');
    assert.equal(issues[0].invoice_id, inId);
  });

  it('phát hiện thu vượt và payment mồ côi', () => {
    const inId = Number(
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(studentId, 500000, centerId)
        .lastInsertRowid
    );
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'confirmed')").run(inId, 700000);
    // payment mồ côi: tắt FK tạm để chèn (mô phỏng DB cũ trước thời FK)
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,?)').run(999999, 100000, 'confirmed');
    db.pragma('foreign_keys = ON');
    const issues = checkFinancialConsistency(db);
    const codes = issues.map((i) => i.code).sort();
    assert.ok(codes.includes('overpaid_invoice'), `thiếu overpaid: ${codes}`);
    assert.ok(codes.includes('orphan_payment'), `thiếu orphan: ${codes}`);
  });

  it('payment pending không tính vào công nợ nên không báo drift', () => {
    const inId = Number(
      db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?,?,?)').run(studentId, 1000000, centerId)
        .lastInsertRowid
    );
    db.prepare("INSERT INTO payments (invoice_id, amount, status) VALUES (?,?,'pending')").run(inId, 1000000);
    assert.deepEqual(checkFinancialConsistency(db), []);
  });
});
