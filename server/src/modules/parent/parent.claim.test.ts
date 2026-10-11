/**
 * Cổng phụ huynh — thanh toán (CI-3):
 * - claim-paid: hóa đơn của phụ huynh khác -> 404; tạo khoản 'pending' KHÔNG giảm công nợ; gửi lại trả khoản cũ
 * - vietqr: phụ huynh khác -> 404; chưa cấu hình ngân hàng -> 400; số tiền = phần còn nợ
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setCenterSetting } from '../../db/helpers';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import { getDebtSummary } from '../invoices/invoices.service';
import { claimPaid, getVietqrInfo } from './parent.service';

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const is = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code;

let center = 0;
let parentA = 0;
let parentB = 0;
let invoice = 0;

describe('parent payments (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    center = await id("INSERT INTO centers (name) VALUES ('TT')");
    const st = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'A', ?)", center);
    parentA = await id(
      "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000001', 'x', 'PH A', ?)",
      center
    );
    parentB = await id(
      "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000002', 'x', 'PH B', ?)",
      center
    );
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parentA, st);
    invoice = await id(
      'INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 1000000, ?)',
      st,
      center
    );
    await id("INSERT INTO payments (invoice_id, amount, method) VALUES (?, 300000, 'Tiền mặt')", invoice);
  });
  after(async () => {
    await teardownTestDb();
  });

  it('claim-paid: phụ huynh khác -> 404, không tạo khoản', async () => {
    await assert.rejects(claimPaid(parentB, invoice), is(404));
    assert.equal(await db.prepare('SELECT 1 FROM payments WHERE status = ?').get('pending'), undefined);
  });

  it('claim-paid: khoản pending = phần còn nợ, không giảm nợ; gửi lại trả khoản cũ', async () => {
    const r = await claimPaid(parentA, invoice);
    assert.equal(r.status, 'pending');
    const p = (await db.prepare('SELECT amount, method FROM payments WHERE id = ?').get(r.payment_id)) as {
      amount: number;
      method: string;
    };
    assert.deepEqual({ ...p, amount: Number(p.amount) }, { amount: 700000, method: 'bank_transfer' });
    assert.equal((await getDebtSummary(center)).totalDebt, 700000, 'pending không được tính là đã thu');
    assert.equal((await claimPaid(parentA, invoice)).payment_id, r.payment_id);
  });

  it('vietqr: phụ huynh khác -> 404; chưa cấu hình -> 400; đủ cấu hình -> số còn nợ', async () => {
    await assert.rejects(getVietqrInfo(parentB, invoice), is(404));
    await assert.rejects(getVietqrInfo(parentA, invoice), is(400));
    await setCenterSetting(center, 'pay_bank_code', 'VCB');
    await setCenterSetting(center, 'pay_bank_account_no', '0123456789');
    await setCenterSetting(center, 'pay_bank_account_name', 'TRUNG TAM A');
    const q = await getVietqrInfo(parentA, invoice);
    assert.equal(q.amount, 700000);
    assert.equal(q.addInfo, `HD${invoice}`);
    assert.match(
      String(q.qr_url),
      /^https:\/\/img\.vietqr\.io\/image\/VCB-0123456789-compact2\.png\?amount=700000&/
    );
  });
});
