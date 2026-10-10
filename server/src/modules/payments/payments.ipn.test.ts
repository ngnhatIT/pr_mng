/**
 * Unit test cho handleVnpayIpn (payments.service.ts) — KHÔNG cần PostgreSQL.
 * Mock db layer bằng mock-db.ts, ký VNPay bằng đúng thuật toán HMAC-SHA512 của vnpay.ts.
 *
 * Bao phủ 5 case P0 (audit K2a):
 * 1. Chữ ký hợp lệ + amount khớp + txn pending -> RspCode 00, invoice confirmed.
 * 2. Sai chữ ký -> 97, không ghi gì.
 * 3. Sai số tiền -> 04, không ghi gì.
 * 4. Gọi lặp cùng TxnRef -> 00 và chỉ 1 payment (idempotent).
 * 5. 2 IPN đồng thời (Promise.all) -> đúng 1 payment confirmed.
 */
// PHẢI đặt trước mọi import db — config/env fail-fast nếu thiếu DATABASE_URL
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock:mock@localhost:5432/mockdb';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import type { RunResult } from '../../db/pg-compat';
import { handleVnpayIpn } from './payments.service';

const SECRET = 'vnp-test-secret';
const AMOUNT = 500000;
const REF = 'VNP_IPN_TEST_1';
const CENTER_ID = 1;
const STUDENT_ID = 11;
const INVOICE_ID = 21;

interface Txn {
  ref: string;
  invoice_id: number;
  amount: number;
  status: string;
}
interface Invoice {
  id: number;
  student_id: number;
  amount: number;
  status: string;
}
interface Payment {
  invoice_id: number;
  amount: number;
  status: string;
}

let txns: Map<string, Txn>;
let invoices: Map<number, Invoice>;
let payments: Payment[];
let restore: (() => void) | null = null;

/** Giả lập VNPay ký lại params trả về (giống thuật toán trong services/vnpay.ts). */
function vnpaySign(params: Record<string, string>): string {
  const signData = Object.keys(params)
    .filter((k) => k.startsWith('vnp_'))
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHmac('sha512', SECRET).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

/** Dựng query IPN như VNPay gửi về (đã ký đúng). */
function buildIpnQuery(ref: string, amountVnd: number): Record<string, string> {
  const q: Record<string, string> = {
    vnp_TmnCode: 'TMNTEST',
    vnp_TxnRef: ref,
    vnp_Amount: String(amountVnd * 100),
    vnp_ResponseCode: '00',
    vnp_TransactionNo: '987654321',
    vnp_OrderInfo: 'Hoc phi',
  };
  q.vnp_SecureHash = vnpaySign(q);
  return q;
}

function okRun(): RunResult {
  return { changes: 1, lastInsertRowid: undefined };
}

/** Dựng lại state + routes mock trước mỗi case (route cụ thể đặt trước route chung). */
function setupState(txnStatus = 'pending'): void {
  txns = new Map([
    [REF, { ref: REF, invoice_id: INVOICE_ID, amount: AMOUNT, status: txnStatus }],
  ]);
  invoices = new Map([
    [INVOICE_ID, { id: INVOICE_ID, student_id: STUDENT_ID, amount: AMOUNT, status: 'unpaid' }],
  ]);
  payments = [];
  const routes: MockRoute[] = [
    {
      match: 'FROM payment_txns WHERE ref = ? FOR UPDATE',
      get: (p) => {
        const t = txns.get(String(p[0]));
        return t ? { status: t.status } : undefined;
      },
    },
    { match: 'FROM payment_txns WHERE ref = ?', get: (p) => txns.get(String(p[0])) },
    {
      match: "SET status = 'failed' WHERE ref = ? AND status = 'pending'",
      run: (p) => {
        const t = txns.get(String(p[0]));
        if (t && t.status === 'pending') t.status = 'failed';
        return okRun();
      },
    },
    {
      match: "SET status = 'confirmed' WHERE ref = ? AND status = 'pending'",
      run: (p) => {
        const t = txns.get(String(p[0]));
        if (t && t.status === 'pending') t.status = 'confirmed';
        return okRun();
      },
    },
    {
      match: "SET status = 'failed' WHERE ref = ?",
      run: (p) => {
        const t = txns.get(String(p[0]));
        if (t) t.status = 'failed';
        return okRun();
      },
    },
    {
      match: 'FROM invoices WHERE id = ? FOR UPDATE',
      get: (p) => {
        const i = invoices.get(Number(p[0]));
        return i ? { id: i.id, amount: i.amount } : undefined;
      },
    },
    { match: 'FROM invoices WHERE id = ?', get: (p) => invoices.get(Number(p[0])) },
    { match: 'FROM students WHERE id = ?', get: () => ({ id: STUDENT_ID, center_id: CENTER_ID }) },
    {
      match: 'FROM center_settings WHERE center_id = ? AND key = ?',
      get: () => ({ value: SECRET }),
    },
    {
      match: 'FROM payments WHERE invoice_id = ?',
      get: (p) => ({
        paid: payments
          .filter((x) => x.invoice_id === Number(p[0]) && x.status === 'confirmed')
          .reduce((s, x) => s + x.amount, 0),
      }),
    },
    {
      match: 'INSERT INTO payments',
      run: (p) => {
        payments.push({ invoice_id: Number(p[0]), amount: Number(p[1]), status: 'confirmed' });
        return okRun();
      },
    },
    {
      match: 'UPDATE invoices SET status = ? WHERE id = ?',
      run: (p) => {
        const i = invoices.get(Number(p[1]));
        if (i) i.status = String(p[0]);
        return okRun();
      },
    },
  ];
  if (restore) restore();
  restore = installMockDb(routes);
}

beforeEach(() => setupState());
after(() => restore?.());

describe('handleVnpayIpn', () => {
  it('(1) chữ ký hợp lệ + amount khớp + pending -> 00, invoice confirmed', async () => {
    const r = await handleVnpayIpn(buildIpnQuery(REF, AMOUNT));
    assert.equal(r.RspCode, '00');
    assert.equal(txns.get(REF)?.status, 'confirmed');
    assert.equal(payments.length, 1);
    assert.equal(payments[0].invoice_id, INVOICE_ID);
    assert.equal(payments[0].amount, AMOUNT);
    assert.equal(invoices.get(INVOICE_ID)?.status, 'paid');
  });

  it('(2) sai chữ ký -> 97, không ghi gì', async () => {
    const q = buildIpnQuery(REF, AMOUNT);
    q.vnp_Amount = String((AMOUNT + 1000) * 100); // sửa sau khi ký -> chữ ký hỏng
    const r = await handleVnpayIpn(q);
    assert.equal(r.RspCode, '97');
    assert.equal(txns.get(REF)?.status, 'pending'); // không bị đánh failed
    assert.equal(payments.length, 0);
    assert.equal(invoices.get(INVOICE_ID)?.status, 'unpaid');
  });

  it('(3) sai số tiền -> 04, không ghi gì', async () => {
    const r = await handleVnpayIpn(buildIpnQuery(REF, AMOUNT + 50000)); // ký đúng nhưng lệch amount
    assert.equal(r.RspCode, '04');
    assert.equal(txns.get(REF)?.status, 'failed'); // amount mismatch -> đánh failed
    assert.equal(payments.length, 0);
    assert.equal(invoices.get(INVOICE_ID)?.status, 'unpaid');
  });

  it('(4) gọi lặp cùng TxnRef -> 00 và chỉ 1 payment (idempotent)', async () => {
    const q = buildIpnQuery(REF, AMOUNT);
    const r1 = await handleVnpayIpn(q);
    const r2 = await handleVnpayIpn(q);
    assert.equal(r1.RspCode, '00');
    assert.equal(r2.RspCode, '00');
    assert.equal(payments.length, 1);
    assert.equal(invoices.get(INVOICE_ID)?.status, 'paid');
  });

  it('(5) 2 IPN đồng thời -> đúng 1 payment confirmed', async () => {
    const [a, b] = await Promise.all([
      handleVnpayIpn(buildIpnQuery(REF, AMOUNT)),
      handleVnpayIpn(buildIpnQuery(REF, AMOUNT)),
    ]);
    assert.equal(a.RspCode, '00');
    assert.equal(b.RspCode, '00');
    assert.equal(payments.length, 1);
    assert.equal(txns.get(REF)?.status, 'confirmed');
    assert.equal(invoices.get(INVOICE_ID)?.status, 'paid');
  });
});
