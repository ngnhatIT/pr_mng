/**
 * Idempotency + race test cho luồng tiền:
 * 1. VNPay gọi callback 2 lần cùng ref -> chỉ 1 payment confirmed (chống double-charge).
 * 2. Duyệt payment 2 lần (kể cả đồng thời) -> chỉ 1 thành công, lần 2 throw 404.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { setCenterSetting } from '../../db/helpers';
import { AppError } from '../../shared/errors';
import * as invoicesService from '../invoices/invoices.service';
import * as paymentsService from './payments.service';

const VNP_SECRET = 'test-hash-secret-xyz';
const TXN_REF = 'VNP_REPLAY_TEST_1';
const AMOUNT = 500000;

let centerId = 0;
let studentId = 0;
let invoiceId = 0;

/** Giả lập VNPay ký (bản chép độc lập mẫu Node chính thức: encode giá trị, khoảng trắng -> '+'). */
function vnpaySign(params: Record<string, string>): string {
  const signData = Object.keys(params)
    .map(encodeURIComponent)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHmac('sha512', VNP_SECRET).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

function buildReturnQuery(ref: string): Record<string, string> {
  const q: Record<string, string> = {
    vnp_TmnCode: 'TMNTEST',
    vnp_TxnRef: ref,
    vnp_Amount: String(AMOUNT * 100),
    vnp_ResponseCode: '00',
    vnp_TransactionNo: '987654321',
    vnp_OrderInfo: 'Hoc phi',
  };
  q.vnp_SecureHash = vnpaySign(q);
  return q;
}

async function resetDb(): Promise<void> {
  await resetTestDb();

  const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT Test')").run();
  centerId = Number(cr.lastInsertRowid);
  const sr = await db
    .prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)')
    .run('ST1', 'HV 1', centerId);
  studentId = Number(sr.lastInsertRowid);
  const inv = (await invoicesService.createInvoice(centerId, { student_id: studentId, amount: AMOUNT })) as {
    id: number;
  };
  invoiceId = inv.id;

  await setCenterSetting(centerId, 'pay_vnp_hashsecret', VNP_SECRET);
  await db
    .prepare("INSERT INTO payment_txns (ref, invoice_id, amount, status) VALUES (?, ?, ?, 'pending')")
    .run(TXN_REF, invoiceId, AMOUNT);
}

async function confirmedPaymentCount(): Promise<number> {
  const r = (await db
    .prepare("SELECT COUNT(*)::int as c FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
    .get(invoiceId)) as { c: number };
  return r.c;
}

async function txnStatus(ref: string): Promise<string> {
  const r = (await db.prepare('SELECT status FROM payment_txns WHERE ref = ?').get(ref)) as {
    status: string;
  };
  return r.status;
}

async function createPendingPayment(): Promise<number> {
  const r = await db
    .prepare(
      "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'cash', 'test', 'pending')"
    )
    .run(invoiceId, 100000);
  return Number(r.lastInsertRowid);
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('payments.idempotency - VNPay replay (IPN)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('gọi handleVnpayIpn 2 lần cùng ref -> chỉ 1 payment confirmed', async () => {
    const q = buildReturnQuery(TXN_REF);

    const r1 = await paymentsService.handleVnpayIpn(q);
    assert.equal(r1.RspCode, '00', `lần 1 phải Confirm Success, got: ${JSON.stringify(r1)}`);
    assert.equal(await confirmedPaymentCount(), 1);
    assert.equal(await txnStatus(TXN_REF), 'confirmed');

    const r2 = await paymentsService.handleVnpayIpn(q);
    assert.equal(r2.RspCode, '00', `lần 2 (replay) phải idempotent, got: ${JSON.stringify(r2)}`);
    assert.equal(await confirmedPaymentCount(), 1);
    assert.equal(await txnStatus(TXN_REF), 'confirmed');
  });

  it('G2: handleVnpayReturn KHÔNG ghi gì — chỉ hiển thị theo DB', async () => {
    const q = buildReturnQuery(TXN_REF);

    // Return về trước IPN: chữ ký hợp lệ nhưng txn vẫn pending -> status=pending, DB nguyên vẹn
    const url1 = await paymentsService.handleVnpayReturn(q);
    assert.ok(url1.includes('status=pending'), `phải pending chờ IPN, got: ${url1}`);
    assert.equal(await confirmedPaymentCount(), 0, 'return URL không được ghi payment');
    assert.equal(await txnStatus(TXN_REF), 'pending', 'return URL không được đổi trạng thái txn');

    // IPN mới là nơi ghi nhận tiền
    const r = await paymentsService.handleVnpayIpn(q);
    assert.equal(r.RspCode, '00');
    assert.equal(await confirmedPaymentCount(), 1);

    // Return về sau IPN -> success
    const url2 = await paymentsService.handleVnpayReturn(q);
    assert.ok(url2.includes('status=success'), `sau IPN phải success, got: ${url2}`);
    assert.equal(await confirmedPaymentCount(), 1, 'return URL không được ghi thêm payment');
  });

  it('G2: handleVnpayReturn chữ ký sai -> fail, không ghi gì', async () => {
    const q = { ...buildReturnQuery(TXN_REF), vnp_SecureHash: 'sai' };
    const url = await paymentsService.handleVnpayReturn(q);
    assert.ok(url.includes('status=fail'), `chữ ký sai phải fail, got: ${url}`);
    assert.equal(await confirmedPaymentCount(), 0);
    assert.equal(await txnStatus(TXN_REF), 'pending');
  });
});

describe('payments.idempotency - approve race', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('duyệt 2 lần tuần tự -> lần 2 throw (đã xử lý)', async () => {
    const pid = await createPendingPayment();
    const r1 = await paymentsService.approvePendingPayment(centerId, pid);
    assert.ok(r1.status);

    await assert.rejects(
      () => paymentsService.approvePendingPayment(centerId, pid),
      (e: unknown) => e instanceof AppError && (e.statusCode === 404 || e.statusCode === 409)
    );

    const row = (await db.prepare('SELECT status FROM payments WHERE id = ?').get(pid)) as { status: string };
    assert.equal(row.status, 'confirmed');
  });

  it('duyệt 2 lần đồng thời -> đúng 1 thành công, 1 throw', async () => {
    const pid = await createPendingPayment();
    const results = await Promise.allSettled([
      paymentsService.approvePendingPayment(centerId, pid),
      paymentsService.approvePendingPayment(centerId, pid),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    const err = (failed[0] as PromiseRejectedResult).reason;
    assert.ok(err instanceof AppError && (err.statusCode === 404 || err.statusCode === 409));

    const row = (await db.prepare('SELECT status FROM payments WHERE id = ?').get(pid)) as { status: string };
    assert.equal(row.status, 'confirmed');
  });

  it('từ chối 2 lần -> lần 2 throw (đã xử lý)', async () => {
    const pid = await createPendingPayment();
    await paymentsService.rejectPendingPayment(centerId, pid);
    await assert.rejects(
      () => paymentsService.rejectPendingPayment(centerId, pid),
      (e: unknown) => e instanceof AppError && (e.statusCode === 404 || e.statusCode === 409)
    );
  });
});
