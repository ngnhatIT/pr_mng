/**
 * Test hoàn tiền (payments.refund):
 * - Hoàn 1 phần: net paid giảm, status về partial
 * - Hoàn hết: status về unpaid
 * - Hoàn vượt số đã thu -> 400
 * - Hoàn khi chưa thu gì -> 400
 * - Hoàn 2 lần đồng thời không vượt số đã thu (race-safe)
 * - Constraint DB chặn payment âm khi method != 'refund'
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { refundInvoice } from './payments.service';
import { recordPayment } from '../invoices/invoices.service';

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

  it('hoàn 1 phần: net paid giảm, status về partial', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 1000000 });
    assert.equal(await invStatus(id), 'paid');
    const r = await refundInvoice(1, id, { amount: 400000, reason: 'Học viên nghỉ giữa chừng' });
    assert.equal(r.refunded, 400000);
    assert.equal(r.status, 'partial');
    assert.equal(await netPaid(id), 600000);
    assert.equal(await invStatus(id), 'partial');
  });

  it('hoàn hết: status về unpaid', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 1000000 });
    const r = await refundInvoice(1, id, { amount: 1000000 });
    assert.equal(r.status, 'unpaid');
    assert.equal(await netPaid(id), 0);
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

  it('hoàn tiền invoice khác center -> 404', async () => {
    const id = await seedInvoice();
    await recordPayment(1, id, { amount: 500000 });
    await assert.rejects(() => refundInvoice(999, id, { amount: 100000 }), /Không tìm thấy/);
  });
});
