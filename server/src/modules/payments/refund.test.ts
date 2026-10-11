/**
 * Test hoàn tiền (payments.refund):
 * - PAY-2: hoàn tiền = điều chỉnh hóa đơn (amount giảm đúng số hoàn) -> KHÔNG mở lại thành nợ/nhắc nợ
 * - PAY-5: phần trả bằng credits được trả lại credits, không hoàn thành tiền mặt
 * - Hoàn vượt số đã thu -> 400
 * - Hoàn khi chưa thu gì -> 400
 * - Hoàn 2 lần đồng thời không vượt số đã thu (race-safe)
 * - Constraint DB chặn payment âm khi method != 'refund'
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { refundInvoice } from './payments.service';
import { recordPayment, getDebtSummary } from '../invoices/invoices.service';
import { applyCreditToInvoice } from '../referrals/rewards.service';

async function seedInvoice(amount = 1000000): Promise<number> {
  await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
  await db.prepare("INSERT INTO students (id, code, name, center_id) VALUES (1, 'HV1', 'A', 1)").run();
  const r = await db
    .prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (1, ?, 1)')
    .run(amount);
  return Number(r.lastInsertRowid);
}

async function netPaid(invoiceId: number): Promise<number> {
  const r = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as p FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId)) as { p: number };
  return Number(r.p);
}

async function invStatus(invoiceId: number): Promise<string> {
  const r = (await db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId)) as {
    status: string;
  };
  return r.status;
}

async function invAmount(invoiceId: number): Promise<number> {
  const r = (await db.prepare('SELECT amount FROM invoices WHERE id = ?').get(invoiceId)) as {
    amount: number;
  };
  return Number(r.amount);
}

describe('refundInvoice (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });

  it('PAY-2: hoàn 1 phần hóa đơn đã đủ: số phải thu giảm, vẫn paid, không phát sinh nợ', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 1000000 });
    assert.equal(await invStatus(id), 'paid');
    const r = await refundInvoice(1, id, { amount: 400000, reason: 'Học viên nghỉ giữa chừng' });
    assert.equal(r.refunded, 400000);
    assert.equal(r.cash, 400000);
    assert.equal(r.status, 'paid');
    assert.equal(await netPaid(id), 600000);
    assert.equal(await invAmount(id), 600000);
    assert.equal(await invStatus(id), 'paid'); // reminderScheduler chỉ nhắc unpaid/partial
    assert.equal((await getDebtSummary(1)).totalDebt, 0);
  });

  it('PAY-2: hoàn hết -> amount 0, không còn nợ', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 1000000 });
    const r = await refundInvoice(1, id, { amount: 1000000 });
    assert.equal(r.status, 'paid');
    assert.equal(await netPaid(id), 0);
    assert.equal(await invAmount(id), 0);
    assert.equal((await getDebtSummary(1)).debtorCount, 0);
  });

  it('hoàn khoản đã thu của hóa đơn chưa đủ: nợ còn lại không đổi', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 300000 });
    const r = await refundInvoice(1, id, { amount: 300000 });
    assert.equal(r.status, 'unpaid');
    assert.equal((await getDebtSummary(1)).totalDebt, 700000);
  });

  it('PAY-5: phần trả bằng credits được trả lại credits, tiền mặt chỉ hoàn phần tiền mặt', async () => {
    const id = await seedInvoice();
    const pr = await db
      .prepare(
        "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000009', 'x', 'PH', 1)"
      )
      .run();
    const parentId = Number(pr.lastInsertRowid);
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, 1)').run(parentId);
    const cr = await db
      .prepare("INSERT INTO credits (parent_id, amount, reason, center_id) VALUES (?, 200000, 'KM', 1)")
      .run(parentId);
    const creditId = Number(cr.lastInsertRowid);
    await applyCreditToInvoice(id, creditId);
    await recordPayment(1, id, { amount: 800000 });
    assert.equal(await invStatus(id), 'paid');
    const r = await refundInvoice(1, id, { amount: 1000000 });
    assert.equal(r.cash, 800000, 'tiền mặt hoàn tối đa phần đã trả bằng tiền mặt');
    assert.equal(r.credit, 200000);
    const credit = (await db.prepare('SELECT used_amount FROM credits WHERE id = ?').get(creditId)) as {
      used_amount: number;
    };
    assert.equal(Number(credit.used_amount), 0, 'credits được trả lại');
    assert.equal(await netPaid(id), 0);
    const refundRows = (await db
      .prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE invoice_id = ? AND method = 'refund'")
      .get(id)) as { s: number };
    assert.equal(Number(refundRows.s), -800000);
  });

  it('hoàn vượt số đã thu -> 400', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 600000 });
    await assert.rejects(() => refundInvoice(1, id, { amount: 700000 }), /tối đa/);
    assert.equal(await netPaid(id), 600000); // không đổi
  });

  it('hoàn khi chưa thu gì -> 400', async () => {
    const id = await seedInvoice();
    await assert.rejects(() => refundInvoice(1, id, { amount: 100000 }), /chưa có khoản thu/);
  });

  it('hoàn 2 lần đồng thời không vượt số đã thu', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 1000000 });
    const results = await Promise.allSettled([
      refundInvoice(1, id, { amount: 700000 }),
      refundInvoice(1, id, { amount: 700000 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 1, 'chỉ 1 lượt hoàn thành công');
    assert.equal(await netPaid(id), 300000);
  });

  it('constraint DB chặn payment âm khi method != refund', async () => {
    const id = await seedInvoice();
    await assert.rejects(() =>
      db
        .prepare(
          "INSERT INTO payments (invoice_id, amount, method, status) VALUES (?, ?, 'cash', 'confirmed')"
        )
        .run(id, -100)
    );
  });

  it('S-1: nhân viên không ghi tay được method hệ thống (credit/refund/vnpay/bank_transfer)', async () => {
    const id = await seedInvoice();
    for (const method of ['credit', 'refund', 'vnpay', 'bank_transfer']) {
      await assert.rejects(
        () => recordPayment(1, id, { amount: 100000, method, note: 'credits #1' }),
        /Hình thức thu không hợp lệ/
      );
    }
    assert.equal(await netPaid(id), 0);
  });

  it('S-1: hoàn tiền không bao giờ trả lại credit của trung tâm khác', async () => {
    const id = await seedInvoice();
    await db.prepare("INSERT INTO centers (id, name) VALUES (2, 'TT2')").run();
    const pr = await db
      .prepare(
        "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000002', 'x', 'PH2', 2)"
      )
      .run();
    const foreign = Number(
      (
        await db
          .prepare(
            "INSERT INTO credits (parent_id, amount, used_amount, reason, center_id) VALUES (?, 500000, 500000, 'KM', 2)"
          )
          .run(Number(pr.lastInsertRowid))
      ).lastInsertRowid
    );
    // Dòng 'credit' giả (dữ liệu cũ trước S-1) trỏ sang credit của trung tâm khác
    await db
      .prepare(
        "INSERT INTO payments (invoice_id, amount, method, note, status, credit_id) VALUES (?, 300000, 'credit', ?, 'confirmed', ?)"
      )
      .run(id, `credits #${foreign}`, foreign);
    const r = await refundInvoice(1, id, { amount: 300000 });
    assert.equal(r.credit, 300000);
    const c = (await db.prepare('SELECT used_amount FROM credits WHERE id = ?').get(foreign)) as {
      used_amount: number;
    };
    assert.equal(Number(c.used_amount), 500000, 'credit trung tâm khác không bị đụng');
  });

  it('C-2: thưởng bị thu hồi khi hoàn hết, hoàn hóa đơn khác từng tiêu nó không hồi sinh', async () => {
    const hd1 = await seedInvoice();
    const hd2 = Number(
      (await db.prepare('INSERT INTO invoices (student_id, amount, center_id) VALUES (1, 500000, 1)').run())
        .lastInsertRowid
    );
    const pr = await db
      .prepare(
        "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000003', 'x', 'PH', 1)"
      )
      .run();
    const parentId = Number(pr.lastInsertRowid);
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, 1)').run(parentId);
    const reward = Number(
      (
        await db
          .prepare(
            "INSERT INTO credits (parent_id, amount, reason, center_id, source_invoice_id) VALUES (?, 200000, 'Thưởng', 1, ?)"
          )
          .run(parentId, hd1)
      ).lastInsertRowid
    );
    await recordPayment(1, hd1, { amount: 1000000 });
    await applyCreditToInvoice(hd2, reward); // tiêu 200k vào HD2
    const pay = (await db
      .prepare("SELECT credit_id FROM payments WHERE invoice_id = ? AND method = 'credit'")
      .get(hd2)) as {
      credit_id: number;
    };
    assert.equal(pay.credit_id, reward, 'O-2: payment ghi credit_id');
    await refundInvoice(1, hd1, { amount: 1000000 }); // hoàn hết HD1 -> thu hồi thưởng (cùng transaction)
    const after1 = (await db
      .prepare('SELECT voided_at, used_amount FROM credits WHERE id = ?')
      .get(reward)) as {
      voided_at: string | null;
      used_amount: number;
    };
    assert.ok(after1.voided_at);
    assert.equal(Number(after1.used_amount), 200000);
    await refundInvoice(1, hd2, { amount: 200000 }); // hoàn phần credits của HD2
    const after2 = (await db.prepare('SELECT used_amount FROM credits WHERE id = ?').get(reward)) as {
      used_amount: number;
    };
    assert.equal(Number(after2.used_amount), 200000, 'credit đã thu hồi không được hồi sinh');
  });

  it('hoàn tiền invoice khác center -> 404', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 500000 });
    await assert.rejects(() => refundInvoice(999, id, { amount: 100000 }), /Không tìm thấy/);
  });
});
