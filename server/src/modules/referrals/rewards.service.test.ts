/**
 * Test thưởng giới thiệu (afterInvoicePaid), áp dụng credits (applyCreditToInvoice) trên PostgreSQL.
 * REF-1: khớp referral theo trung tâm, chỉ referral tạo trước khi học viên nhập học.
 * REF-2: thưởng bị lỡ được sweepReferralRewards thưởng bù. PAY-5: hoàn hết -> thu hồi thưởng.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import {
  afterInvoicePaid,
  applyCreditToInvoice,
  createReferral,
  sweepReferralRewards,
} from './rewards.service';
import { recordPayment } from '../invoices/invoices.service';
import { refundInvoice } from '../payments/payments.service';

let centerA = 0;
let centerB = 0;
let referrer = 0;

async function id(sql: string, ...p: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).run(...p)).lastInsertRowid);
}
const center = (name: string) => id('INSERT INTO centers (name) VALUES (?)', name);
const parent = (cid: number, phone: string) =>
  id("INSERT INTO parents (phone, password_hash, name, center_id) VALUES (?, 'x', 'PH', ?)", phone, cid);
const student = (cid: number, phone: string, createdAt = '2026-10-01 10:00:00') =>
  id(
    'INSERT INTO students (code, name, phone, center_id, created_at) VALUES (?, ?, ?, ?, ?)',
    'HV' + Math.random().toString(36).slice(2, 8),
    'HV',
    phone,
    cid,
    createdAt
  );
const invoice = (sid: number, cid: number, amount = 1000000) =>
  id('INSERT INTO invoices (student_id, amount, center_id) VALUES (?, ?, ?)', sid, amount, cid);
const referral = (cid: number, phone: string, createdAt = '2026-09-01 10:00:00') =>
  id(
    "INSERT INTO referrals (referrer_parent_id, referred_phone, status, center_id, created_at) VALUES (?, ?, 'pending', ?, ?)",
    referrer,
    phone,
    cid,
    createdAt
  );
const credits = async (parentId: number) =>
  (await db
    .prepare('SELECT amount, used_amount FROM credits WHERE parent_id = ? ORDER BY id')
    .all(parentId)) as {
    amount: number;
    used_amount: number;
  }[];
const refStatus = async (rid: number) =>
  ((await db.prepare('SELECT status FROM referrals WHERE id = ?').get(rid)) as { status: string }).status;

before(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  centerA = await center('A');
  centerB = await center('B');
  referrer = await parent(centerA, '0911111111');
});
after(async () => {
  await teardownTestDb();
});

describe('afterInvoicePaid — thưởng giới thiệu', () => {
  it('học viên mới khớp SĐT referral cùng trung tâm -> thưởng cả 2 bên, chỉ 1 lần', async () => {
    const rid = await referral(centerA, '0922222222');
    const sid = await student(centerA, '0922222222');
    const childParent = await parent(centerA, '0933333333');
    await db
      .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
      .run(childParent, sid);
    const inv = await invoice(sid, centerA);
    await recordPayment(centerA, inv, { amount: 1000000 }); // paid -> afterInvoicePaid
    assert.equal(await refStatus(rid), 'rewarded');
    assert.deepEqual(
      (await credits(referrer)).map((c) => Number(c.amount)),
      [200000]
    );
    assert.deepEqual(
      (await credits(childParent)).map((c) => Number(c.amount)),
      [200000]
    );
    // hóa đơn thứ 2 paid -> không thưởng thêm
    const inv2 = await invoice(sid, centerA);
    await recordPayment(centerA, inv2, { amount: 1000000 });
    assert.equal((await credits(referrer)).length, 1);
  });

  it('REF-1: học viên trung tâm khác trùng SĐT -> KHÔNG nhận referral', async () => {
    const rid = await referral(centerA, '0922222222');
    const sid = await student(centerB, '0922222222');
    const inv = await invoice(sid, centerB);
    await recordPayment(centerB, inv, { amount: 1000000 });
    assert.equal(await refStatus(rid), 'pending');
    assert.equal((await credits(referrer)).length, 0);
  });

  it('REF-1: referral tạo SAU khi học viên đã nhập học -> không khớp (chống nhận vơ học viên cũ)', async () => {
    const rid = await referral(centerA, '0922222222', '2026-10-05 10:00:00');
    const sid = await student(centerA, '0922222222', '2026-10-01 10:00:00');
    const inv = await invoice(sid, centerA);
    await recordPayment(centerA, inv, { amount: 1000000 });
    assert.equal(await refStatus(rid), 'pending');
  });

  it('REF-1: createReferral bỏ qua SĐT đã là học viên/phụ huynh của trung tâm, gắn center_id', async () => {
    await student(centerA, '0944444444');
    assert.equal(await createReferral(centerA, referrer, '0944444444'), false);
    assert.equal(await createReferral(centerA, referrer, '0911111111'), false); // SĐT phụ huynh
    assert.equal(await createReferral(centerA, referrer, '0955555555'), true);
    assert.equal(await createReferral(centerA, referrer, '0955555555'), false); // trùng pending
    const r = (await db
      .prepare('SELECT center_id FROM referrals WHERE referred_phone = ?')
      .get('0955555555')) as {
      center_id: number;
    };
    assert.equal(r.center_id, centerA);
  });

  it('REF-2: thưởng bị lỡ (không chạy afterInvoicePaid) -> sweepReferralRewards thưởng bù, idempotent', async () => {
    const rid = await referral(centerA, '0922222222');
    const sid = await student(centerA, '0922222222');
    const inv = await invoice(sid, centerA);
    await db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(inv); // như crash sau commit
    assert.equal(await sweepReferralRewards(), 1);
    assert.equal(await refStatus(rid), 'rewarded');
    assert.equal(await sweepReferralRewards(), 0);
    await afterInvoicePaid(inv);
    assert.equal((await credits(referrer)).length, 1);
  });

  it('PAY-5: hoàn hết hóa đơn đã dùng để thưởng -> credits thưởng chưa dùng bị vô hiệu', async () => {
    await referral(centerA, '0922222222');
    const sid = await student(centerA, '0922222222');
    const inv = await invoice(sid, centerA);
    await recordPayment(centerA, inv, { amount: 1000000 });
    assert.equal((await credits(referrer)).length, 1);
    await refundInvoice(centerA, inv, { amount: 1000000 });
    const [c] = await credits(referrer);
    assert.equal(Number(c.used_amount), Number(c.amount), 'credit thưởng không còn dùng được');
  });
});

describe('applyCreditToInvoice', () => {
  async function setup(creditAmount: number, creditCenter: number | null = centerA) {
    const sid = await student(centerA, '0966666666');
    const pid = await parent(centerA, '0977777777');
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(pid, sid);
    const cid = await id(
      "INSERT INTO credits (parent_id, amount, reason, center_id) VALUES (?, ?, 'KM', ?)",
      pid,
      creditAmount,
      creditCenter
    );
    return { sid, pid, cid, inv: await invoice(sid, centerA, 500000) };
  }

  it('credits < nợ -> trừ hết credits, hóa đơn partial', async () => {
    const { cid, inv } = await setup(200000);
    const r = await applyCreditToInvoice(inv, cid);
    assert.deepEqual(r, { applied: 200000, status: 'partial' });
    const c = (await db.prepare('SELECT used_amount FROM credits WHERE id = ?').get(cid)) as {
      used_amount: number;
    };
    assert.equal(Number(c.used_amount), 200000);
  });

  it('credits > nợ -> chỉ trừ đúng số nợ, hóa đơn paid, phần dư giữ lại', async () => {
    const { cid, inv } = await setup(800000);
    const r = await applyCreditToInvoice(inv, cid);
    assert.deepEqual(r, { applied: 500000, status: 'paid' });
    await assert.rejects(applyCreditToInvoice(inv, cid), /đã thanh toán đủ/);
  });

  it('credits khác trung tâm / chưa gán trung tâm -> từ chối', async () => {
    const other = await setup(100000, centerB);
    await assert.rejects(applyCreditToInvoice(other.inv, other.cid), /không áp dụng cho trung tâm/);
  });
});
