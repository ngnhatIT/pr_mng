/**
 * Integration test handleVnpayIpn / handleVnpayReturn trên PostgreSQL.
 * TEST-2: IPN được ký bằng bản chép độc lập thuật toán mẫu Node chính thức của VNPay
 * (sortObject + stringify không encode lại) — không dùng lại code ký của services/vnpay.ts.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { setCenterSetting } from '../../db/helpers';
import { handleVnpayIpn, handleVnpayReturn, reconcileVnpayTxn } from './payments.service';
import { recordPayment, deleteInvoice } from '../invoices/invoices.service';

const SECRET = 'vnp-test-secret';
const AMOUNT = 500000;
const REF = 'HD_IPN_TEST_1';
let centerId = 0;
let invoiceId = 0;

function sortObject(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const keys = Object.keys(obj).map(encodeURIComponent).sort();
  for (const k of keys) sorted[k] = encodeURIComponent(obj[k]).replace(/%20/g, '+');
  return sorted;
}

/** IPN như VNPay gửi (đã ký đúng theo mẫu chính thức), ở dạng Express đã decode. */
function ipn(
  ref: string,
  amountVnd: number,
  over: Record<string, string> = {},
  secret = SECRET
): Record<string, string> {
  const p: Record<string, string> = {
    vnp_TmnCode: 'TMNTEST',
    vnp_TxnRef: ref,
    vnp_Amount: String(amountVnd * 100),
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TransactionNo: '987654321',
    vnp_OrderInfo: 'Thanh toan hoc phi',
    vnp_PayDate: '20261010143500',
    ...over,
  };
  const signData = querystring.stringify(sortObject(p), '&', '=', { encodeURIComponent: (s: string) => s });
  return { ...p, vnp_SecureHash: crypto.createHmac('sha512', secret).update(signData).digest('hex') };
}

async function one<T>(sql: string, ...p: unknown[]): Promise<T> {
  return (await db.prepare(sql).get(...p)) as T;
}
const txnStatus = async (ref = REF) =>
  (await one<{ status: string }>('SELECT status FROM payment_txns WHERE ref = ?', ref)).status;
const invStatus = async () =>
  (await one<{ status: string }>('SELECT status FROM invoices WHERE id = ?', invoiceId)).status;
const payments = async () =>
  (await db
    .prepare('SELECT amount, status, method FROM payments WHERE invoice_id = ? ORDER BY id')
    .all(invoiceId)) as {
    amount: number;
    status: string;
    method: string;
  }[];

before(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  centerId = Number((await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run()).lastInsertRowid);
  const st = await db
    .prepare("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'A', ?)")
    .run(centerId);
  invoiceId = Number(
    (
      await db
        .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)')
        .run(Number(st.lastInsertRowid), AMOUNT, centerId)
    ).lastInsertRowid
  );
  await db
    .prepare("INSERT INTO payment_txns (ref, invoice_id, amount, status) VALUES (?, ?, ?, 'pending')")
    .run(REF, invoiceId, AMOUNT);
  await setCenterSetting(centerId, 'pay_vnp_hashsecret', SECRET);
  await setCenterSetting(centerId, 'pay_vnp_tmncode', 'TMNTEST');
});
after(async () => {
  await teardownTestDb();
});

describe('handleVnpayIpn', () => {
  it('chữ ký hợp lệ + amount khớp + pending -> 00, ghi 1 payment, hóa đơn paid', async () => {
    const r = await handleVnpayIpn(ipn(REF, AMOUNT));
    assert.equal(r.RspCode, '00');
    assert.equal(await txnStatus(), 'confirmed');
    assert.deepEqual(
      (await payments()).map((p) => [Number(p.amount), p.status, p.method]),
      [[AMOUNT, 'confirmed', 'vnpay']]
    );
    assert.equal(await invStatus(), 'paid');
  });

  it('sai chữ ký -> 97, không ghi gì', async () => {
    const q = ipn(REF, AMOUNT);
    q.vnp_Amount = String((AMOUNT + 1000) * 100);
    assert.equal((await handleVnpayIpn(q)).RspCode, '97');
    assert.equal(await txnStatus(), 'pending');
    assert.equal((await payments()).length, 0);
  });

  it('PAY-7: sai chữ ký không tiết lộ txn đã xác nhận / không tồn tại (đều 97)', async () => {
    await handleVnpayIpn(ipn(REF, AMOUNT));
    assert.equal((await handleVnpayIpn(ipn(REF, AMOUNT, {}, 'sai'))).RspCode, '97');
    assert.equal((await handleVnpayIpn(ipn('HD_KHONG_CO', AMOUNT, {}, 'sai'))).RspCode, '97');
  });

  it('txn không tồn tại nhưng chữ ký hợp lệ (theo TmnCode) -> 01', async () => {
    assert.equal((await handleVnpayIpn(ipn('HD_KHONG_CO', AMOUNT))).RspCode, '01');
  });

  it('sai số tiền (ký đúng) -> 04, txn failed', async () => {
    assert.equal((await handleVnpayIpn(ipn(REF, AMOUNT + 50000))).RspCode, '04');
    assert.equal(await txnStatus(), 'failed');
    assert.equal((await payments()).length, 0);
  });

  it('PAY-6: khách hủy / thất bại -> 00 (đã nhận), txn failed, không ghi tiền', async () => {
    const r = await handleVnpayIpn(ipn(REF, AMOUNT, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }));
    assert.equal(r.RspCode, '00');
    assert.equal(await txnStatus(), 'failed');
    assert.equal((await payments()).length, 0);
    assert.equal(await invStatus(), 'unpaid');
  });

  it('gọi lặp cùng TxnRef -> 00 và chỉ 1 payment (idempotent)', async () => {
    const q = ipn(REF, AMOUNT);
    assert.equal((await handleVnpayIpn(q)).RspCode, '00');
    assert.equal((await handleVnpayIpn(q)).RspCode, '00');
    assert.equal((await payments()).length, 1);
  });

  it('2 IPN đồng thời -> đúng 1 payment confirmed', async () => {
    const [a, b] = await Promise.all([handleVnpayIpn(ipn(REF, AMOUNT)), handleVnpayIpn(ipn(REF, AMOUNT))]);
    assert.equal(a.RspCode, '00');
    assert.equal(b.RspCode, '00');
    assert.equal((await payments()).filter((p) => p.status === 'confirmed').length, 1);
  });

  it('PAY-3: thu vượt (nhân viên đã thu tay một phần) -> 00, txn needs_review, payment pending, không overpay', async () => {
    await recordPayment(centerId, invoiceId, { amount: 300000 });
    const r = await handleVnpayIpn(ipn(REF, AMOUNT));
    assert.equal(r.RspCode, '00');
    assert.equal(await txnStatus(), 'needs_review');
    const ps = await payments();
    assert.deepEqual(
      ps.map((p) => [Number(p.amount), p.status]),
      [
        [300000, 'confirmed'],
        [AMOUNT, 'pending'],
      ]
    );
    assert.equal(await invStatus(), 'partial');
    // VNPay retry -> không ghi thêm
    assert.equal((await handleVnpayIpn(ipn(REF, AMOUNT))).RspCode, '02');
    assert.equal((await payments()).length, 2);
  });

  it('PAY-3: không xóa được hóa đơn còn giao dịch VNPay pending', async () => {
    await assert.rejects(deleteInvoice(centerId, invoiceId), /VNPay/);
  });

  it('DATA-13: txn bị đối soát đánh failed, IPN thành công về trễ vẫn ghi nhận tiền', async () => {
    await db.prepare("UPDATE payment_txns SET status = 'failed' WHERE ref = ?").run(REF);
    assert.equal((await handleVnpayIpn(ipn(REF, AMOUNT))).RspCode, '00');
    assert.equal(await txnStatus(), 'confirmed');
    assert.equal(await invStatus(), 'paid');
  });
});

describe('reconcileVnpayTxn (querydr đã verify)', () => {
  it('TransactionStatus 00 -> confirm qua cùng đường IPN', async () => {
    const r = await reconcileVnpayTxn({
      vnp_TxnRef: REF,
      vnp_Amount: String(AMOUNT * 100),
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '1',
    });
    assert.equal(r.kind, 'confirmed');
    assert.equal(await invStatus(), 'paid');
  });
});

describe('handleVnpayReturn', () => {
  it('chữ ký hợp lệ, IPN chưa về -> pending; sai chữ ký -> invalid_signature', async () => {
    assert.match(await handleVnpayReturn(ipn(REF, AMOUNT)), /status=pending/);
    assert.match(await handleVnpayReturn(ipn(REF, AMOUNT, {}, 'sai')), /invalid_signature/);
    await handleVnpayIpn(ipn(REF, AMOUNT));
    assert.match(await handleVnpayReturn(ipn(REF, AMOUNT)), /status=success/);
  });
});
