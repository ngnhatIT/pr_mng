/**
 * deleteStudent (CI-3): xóa học viên kéo theo xóa hóa đơn/khoản thu — đường tiền.
 * - trung tâm khác -> 404, không xóa gì
 * - còn nợ / có thanh toán confirmed / VNPay đang chờ -> 400
 * - cùng trung tâm -> xóa; payment_history ghi dòng 'delete' có changed_by; audit_logs có dòng
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, requestActor } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import { deleteStudent } from './students.service';

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const is = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code;
const exists = async (sid: number) => !!(await db.prepare('SELECT 1 FROM students WHERE id = ?').get(sid));

let centerA = 0;
let student = 0;
let invoice = 0;

describe('deleteStudent (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    centerA = await id("INSERT INTO centers (name) VALUES ('TT A')");
    student = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'A', ?)", centerA);
    // Hóa đơn 0đ (đã hoàn hết) + 1 khoản chờ duyệt: không nợ, không confirmed -> được xóa
    invoice = await id(
      'INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 0, ?)',
      student,
      centerA
    );
    await id(
      "INSERT INTO payments (invoice_id, amount, method, status) VALUES (?, 1000, 'bank_transfer', 'pending')",
      invoice
    );
  });
  after(async () => {
    await teardownTestDb();
  });

  it('trung tâm khác -> 404, không xóa', async () => {
    const centerB = await id("INSERT INTO centers (name) VALUES ('TT B')");
    await assert.rejects(deleteStudent(centerB, student), is(404));
    assert.ok(await exists(student));
  });

  it('còn nợ -> 400', async () => {
    await id('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 500000, ?)', student, centerA);
    await assert.rejects(deleteStudent(centerA, student), /còn nợ/);
    assert.ok(await exists(student));
  });

  it('VNPay đang chờ -> 400 (cascade sẽ mất dấu giao dịch)', async () => {
    await db
      .prepare("INSERT INTO payment_txns (ref, invoice_id, amount, status) VALUES ('R1', ?, 1000, 'pending')")
      .run(invoice);
    await assert.rejects(deleteStudent(centerA, student), /VNPay/);
    assert.ok(await exists(student));
  });

  it('cùng trung tâm -> xóa; payment_history có changed_by; audit ghi center', async () => {
    await requestActor.run('5:admin', () =>
      deleteStudent(centerA, student, { id: 5, name: 'Admin', role: 'admin' })
    );
    assert.equal(await exists(student), false);
    assert.equal(await db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(invoice), undefined);
    const h = (await db
      .prepare(
        "SELECT changed_by FROM payment_history WHERE action = 'delete' AND (old_data::json->>'invoice_id')::int = ?"
      )
      .get(invoice)) as { changed_by: number } | undefined;
    assert.equal(h?.changed_by, 5);
    const a = (await db
      .prepare(
        "SELECT center_id FROM audit_logs WHERE entity = 'students' AND action = 'delete' AND entity_id = ?"
      )
      .get(student)) as { center_id: number } | undefined;
    assert.equal(a?.center_id, centerA);
  });
});
