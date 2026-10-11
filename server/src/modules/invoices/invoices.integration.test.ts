/**
 * Integration test trên PostgreSQL.
 * Dùng database test RIÊNG (educenter_test), không động vào DB chính.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import * as invoicesService from './invoices.service';
import * as paymentsService from '../payments/payments.service';
import * as parentService from '../parent/parent.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let centerId = 1;
let studentId = 0;
let parentId = 0;

async function resetDb(): Promise<void> {
  await resetTestDb();

  const cr = await db.prepare("INSERT INTO centers (name) VALUES ('Trung tâm Test')").run();
  centerId = Number(cr.lastInsertRowid);
  const clr = await db
    .prepare('INSERT INTO classes (name, center_id) VALUES (?, ?)')
    .run('Lớp Test', centerId);
  const classId = Number(clr.lastInsertRowid);
  const sr = await db
    .prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)')
    .run('ST001', 'Học viên 1', centerId);
  studentId = Number(sr.lastInsertRowid);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classId);
  const pr = await db
    .prepare(
      "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000001', 'x', 'PH 1', ?)"
    )
    .run(centerId);
  parentId = Number(pr.lastInsertRowid);
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parentId, studentId);
}

async function createInvoice(amount = 1000000): Promise<number> {
  const inv = (await invoicesService.createInvoice(centerId, { student_id: studentId, amount })) as {
    id: number;
  };
  return inv.id;
}

async function count(table: string, where = ''): Promise<number> {
  const r = await db.query(`SELECT COUNT(*)::int as c FROM ${table} ${where}`);
  return (r.rows[0] as { c: number }).c;
}

async function invoiceStatus(id: number): Promise<string> {
  const row = (await db.prepare('SELECT status FROM invoices WHERE id = ?').get(id)) as { status: string };
  return row.status;
}

async function confirmedPaid(invoiceId: number): Promise<number> {
  const row = (await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'"
    )
    .get(invoiceId)) as { paid: number };
  return Number(row.paid);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Setup/teardown chung cho cả file (1 lần)
before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('invoices.service - createInvoice', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('tạo hóa đơn hợp lệ', async () => {
    const inv = (await invoicesService.createInvoice(centerId, {
      student_id: studentId,
      amount: 1500000,
      due_date: '2026-12-31',
      note: 'Học phí T12',
    })) as { id: number; amount: number; status: string };
    assert.ok(inv.id > 0);
    assert.equal(inv.amount, 1500000);
    assert.equal(inv.status, 'unpaid');
  });

  it('số tiền <= 0 → throw', async () => {
    await assert.rejects(
      invoicesService.createInvoice(centerId, { student_id: studentId, amount: 0 }),
      /lớn hơn 0/
    );
    await assert.rejects(
      invoicesService.createInvoice(centerId, { student_id: studentId, amount: -500 }),
      /lớn hơn 0/
    );
    assert.equal(await count('invoices'), 0);
  });

  it('học viên không tồn tại → throw 404', async () => {
    await assert.rejects(
      invoicesService.createInvoice(centerId, { student_id: 99999, amount: 1000 }),
      /Không tìm thấy học viên/
    );
  });

  it('học viên khác center → throw 404 (chống lộ dữ liệu)', async () => {
    const cr = await db.prepare("INSERT INTO centers (name) VALUES ('TT khác')").run();
    const otherCenter = Number(cr.lastInsertRowid);
    await assert.rejects(
      invoicesService.createInvoice(otherCenter, { student_id: studentId, amount: 1000 }),
      /Không tìm thấy học viên/
    );
  });
});

describe('invoices.service - recordPayment (thu tiền)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('thu đủ → status paid', async () => {
    const id = await createInvoice(1000000);
    const r = await invoicesService.recordPayment(centerId, id, { amount: 1000000, method: 'Tiền mặt' });
    assert.equal((r as { status: string }).status, 'paid');
    assert.equal(await invoiceStatus(id), 'paid');
    assert.equal(await confirmedPaid(id), 1000000);
  });

  it('thu một phần → status partial, công nợ đúng', async () => {
    const id = await createInvoice(1000000);
    const r = await invoicesService.recordPayment(centerId, id, { amount: 400000 });
    assert.equal((r as { status: string }).status, 'partial');
    assert.equal(await confirmedPaid(id), 400000);
    // Thu nốt
    const r2 = await invoicesService.recordPayment(centerId, id, { amount: 600000 });
    assert.equal((r2 as { status: string }).status, 'paid');
    assert.equal(await confirmedPaid(id), 1000000);
  });

  it('thu vượt số còn nợ → throw, không ghi payment', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 600000 });
    await assert.rejects(
      invoicesService.recordPayment(centerId, id, { amount: 500000 }),
      /vượt quá số còn nợ/
    );
    assert.equal(await count('payments'), 1);
    assert.equal(await confirmedPaid(id), 600000);
  });

  it('payment pending KHÔNG tính vào công nợ đã thu', async () => {
    const id = await createInvoice(1000000);
    // Phụ huynh báo đã chuyển khoản → pending
    await parentService.claimPaid(parentId, id);
    assert.equal(await confirmedPaid(id), 0);
    assert.equal(await invoiceStatus(id), 'unpaid');
  });

  it('số tiền âm → throw', async () => {
    const id = await createInvoice(1000000);
    await assert.rejects(invoicesService.recordPayment(centerId, id, { amount: -100 }), /lớn hơn 0/);
  });
});

describe('payments.service - duyệt/từ chối', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('duyệt payment pending → confirmed, recalc status', async () => {
    const id = await createInvoice(1000000);
    const { payment_id } = await parentService.claimPaid(parentId, id);
    const r = await paymentsService.approvePendingPayment(centerId, payment_id);
    assert.equal(r.status, 'paid');
    assert.equal(await confirmedPaid(id), 1000000);
    assert.equal(await invoiceStatus(id), 'paid');
  });

  it('duyệt payment đã duyệt rồi → throw 404', async () => {
    const id = await createInvoice(1000000);
    const { payment_id } = await parentService.claimPaid(parentId, id);
    await paymentsService.approvePendingPayment(centerId, payment_id);
    await assert.rejects(paymentsService.approvePendingPayment(centerId, payment_id), /đang chờ duyệt/);
  });

  it('từ chối payment → rejected, công nợ không đổi', async () => {
    const id = await createInvoice(1000000);
    const { payment_id } = await parentService.claimPaid(parentId, id);
    await paymentsService.rejectPendingPayment(centerId, payment_id);
    const st = (
      (await db.prepare('SELECT status FROM payments WHERE id = ?').get(payment_id)) as { status: string }
    ).status;
    assert.equal(st, 'rejected');
    assert.equal(await confirmedPaid(id), 0);
    assert.equal(await invoiceStatus(id), 'unpaid');
  });

  it('duyệt payment không tồn tại → throw 404', async () => {
    await assert.rejects(paymentsService.approvePendingPayment(centerId, 99999), /đang chờ duyệt/);
  });

  it('listPendingPayments chỉ liệt kê pending', async () => {
    const id1 = await createInvoice(1000000);
    const id2 = await createInvoice(500000);
    const p1 = await parentService.claimPaid(parentId, id1);
    await parentService.claimPaid(parentId, id2);
    await paymentsService.approvePendingPayment(centerId, p1.payment_id);
    const list = (await paymentsService.listPendingPayments(centerId)) as { data: { invoice_id: number }[] };
    assert.equal(list.data.length, 1);
    assert.equal(Number(list.data[0].invoice_id), id2);
  });
});

describe('parent.service - claimPaid (báo chuyển khoản)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('báo chuyển khoản tạo payment pending đúng số còn nợ', async () => {
    const id = await createInvoice(1000000);
    const r = await parentService.claimPaid(parentId, id);
    assert.equal(r.status, 'pending');
    const p = (await db
      .prepare('SELECT amount, method, status FROM payments WHERE id = ?')
      .get(r.payment_id)) as {
      amount: number;
      method: string;
      status: string;
    };
    assert.equal(Number(p.amount), 1000000);
    assert.equal(p.method, 'bank_transfer');
    assert.equal(p.status, 'pending');
  });

  it('hóa đơn đã thu đủ → không cho báo nữa', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    await assert.rejects(parentService.claimPaid(parentId, id), /đã thanh toán đủ/);
  });

  it('phụ huynh khác không báo được cho con người khác', async () => {
    const id = await createInvoice(1000000);
    const pr = await db
      .prepare(
        "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000002', 'x', 'PH 2', ?)"
      )
      .run(centerId);
    const otherParent = Number(pr.lastInsertRowid);
    await assert.rejects(parentService.claimPaid(otherParent, id), /Không tìm thấy hóa đơn/);
  });
});

describe('invoices.service - công nợ & xóa', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('getDebtReport tính đúng total/paid/debt', async () => {
    const id1 = await createInvoice(1000000);
    await createInvoice(500000);
    await invoicesService.recordPayment(centerId, id1, { amount: 300000 });
    const report = (await invoicesService.getDebtReport(centerId)) as {
      data: { id: number; total: number; paid: number; debt: number }[];
    };
    assert.equal(report.data.length, 1);
    const row = report.data[0];
    assert.equal(Number(row.total), 1500000);
    assert.equal(Number(row.paid), 300000);
    assert.equal(Number(row.debt), 1200000);
  });

  it('hóa đơn đã paid không vào báo cáo nợ', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    const report = (await invoicesService.getDebtReport(centerId)) as { data: unknown[] };
    assert.equal(report.data.length, 0);
    const summary = await invoicesService.getDebtSummary(centerId);
    assert.equal(Number(summary.totalDebt), 0);
    assert.equal(Number(summary.debtorCount), 0);
  });

  it('xóa hóa đơn chưa có thanh toán xác nhận → cascade xóa payments', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.deleteInvoice(centerId, id);
    assert.equal(await count('invoices', `WHERE id = ${id}`), 0);
    assert.equal(await count('payments', `WHERE invoice_id = ${id}`), 0);
  });

  it('không xóa được hóa đơn đã có thanh toán được xác nhận (audit fix)', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 200000 });
    await assert.rejects(invoicesService.deleteInvoice(centerId, id), /Không thể xóa phiếu thu/);
    assert.equal(await count('invoices', `WHERE id = ${id}`), 1);
    assert.equal(await count('payments', `WHERE invoice_id = ${id}`), 1);
  });

  it('update hóa đơn recalc status (chưa có thanh toán xác nhận)', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.updateInvoice(centerId, id, { amount: 800000 });
    assert.equal(await invoiceStatus(id), 'unpaid');
    await invoicesService.recordPayment(centerId, id, { amount: 300000 });
    assert.equal(await invoiceStatus(id), 'partial');
  });

  it('không sửa được số tiền hóa đơn đã có thanh toán được xác nhận (audit fix)', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    assert.equal(await invoiceStatus(id), 'paid');
    await assert.rejects(
      invoicesService.updateInvoice(centerId, id, { amount: 800000 }),
      /Không thể sửa số tiền/
    );
    assert.equal(await invoiceStatus(id), 'paid');
  });
});

describe('invoices.service - review fixes (ADM-3, ADM-8, INV-2, INV-3, DATA-19)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('ADM-8: getDebtSummary trả số khác 0 khi có nợ (alias camelCase)', async () => {
    const id = await createInvoice(1500000);
    await invoicesService.recordPayment(centerId, id, { amount: 500000 });
    const s = await invoicesService.getDebtSummary(centerId);
    assert.equal(s.totalDebt, 1000000);
    assert.equal(s.debtorCount, 1);
  });

  it('ADM-3: getInvoiceDetail có paid = tổng đã xác nhận', async () => {
    const id = await createInvoice(1000000);
    await invoicesService.recordPayment(centerId, id, { amount: 400000 });
    const d = (await invoicesService.getInvoiceDetail(centerId, id)) as { invoice: { paid: number } };
    assert.equal(Number(d.invoice.paid), 400000);
  });

  it('INV-2: class_id của trung tâm khác -> 404', async () => {
    const other = Number(
      (await db.prepare("INSERT INTO centers (name) VALUES ('Khác')").run()).lastInsertRowid
    );
    const cls = Number(
      (await db.prepare('INSERT INTO classes (name, center_id) VALUES (?, ?)').run('Lớp B', other))
        .lastInsertRowid
    );
    await assert.rejects(
      invoicesService.createInvoice(centerId, { student_id: studentId, class_id: cls, amount: 1000 }),
      /Không tìm thấy lớp/
    );
  });

  it('INV-3: số tiền làm tròn về 0 (0.4) bị chặn', async () => {
    await assert.rejects(
      invoicesService.createInvoice(centerId, { student_id: studentId, amount: 0.4 }),
      /lớn hơn 0/
    );
  });

  it('DATA-19: recalcInvoiceStatus không UPDATE khi trạng thái không đổi (version giữ nguyên)', async () => {
    const { recalcInvoiceStatus } = await import('../../db/helpers');
    const id = await createInvoice(1000000);
    const v = async () =>
      Number(
        ((await db.prepare('SELECT version FROM invoices WHERE id = ?').get(id)) as { version: number })
          .version
      );
    const before = await v();
    assert.equal(await recalcInvoiceStatus(id), 'unpaid');
    assert.equal(await v(), before);
  });
});
