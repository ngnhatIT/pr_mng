/**
 * Integration test cho module tài chính (invoices + payments).
 *
 * Module tiền bạc là chỗ KHÔNG được phép sai, nên bao phủ:
 * - Tạo hóa đơn (validate amount > 0, học viên tồn tại, scope center)
 * - Tính công nợ (confirmedPaid chỉ tính status='confirmed')
 * - Báo đã chuyển khoản → payment pending (parent portal)
 * - Duyệt / từ chối payment → recalc status hóa đơn
 * - Chặn thanh toán vượt số còn nợ
 * - Xóa hóa đơn cascade payments
 *
 * Kỹ thuật DB riêng: giống homework.integration.test.ts — SQLite :memory:
 * + poison require.cache của '../../db' TRƯỚC KHI load services.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

declare const require: NodeRequire;

// ---------------------------------------------------------------------------
// 1. Setup: DB in-memory + schema + migrations
// ---------------------------------------------------------------------------
const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');

const { createSchema } = require('../../db/schema') as typeof import('../../db/schema');
const { runMigrations } = require('../../db/migrations') as typeof import('../../db/migrations');
const { runVersionedMigrations } = require('../../db/versionedMigrations') as typeof import('../../db/versionedMigrations');
const { createIndexes } = require('../../db/indexes') as typeof import('../../db/indexes');
createSchema(testDb);
runMigrations(testDb);
runVersionedMigrations(testDb);
createIndexes(testDb);

// Helpers thay thế db/helpers (vốn bám singleton thật) — bám testDb
function confirmedPaid(invoiceId: number): number {
  const row = testDb
    .prepare("SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
    .get(invoiceId) as { paid: number };
  return row.paid;
}
function recalcInvoiceStatus(invoiceId: number): string {
  const inv = testDb.prepare('SELECT amount FROM invoices WHERE id = ?').get(invoiceId) as
    | { amount: number }
    | undefined;
  if (!inv) return 'unpaid';
  const row = testDb
    .prepare("SELECT COALESCE(SUM(amount),0) as paid FROM payments WHERE invoice_id = ? AND status = 'confirmed'")
    .get(invoiceId) as { paid: number };
  const status = row.paid >= inv.amount - 0.01 ? 'paid' : row.paid > 0 ? 'partial' : 'unpaid';
  testDb.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  return status;
}
function getSetting(key: string, fallback = ''): string {
  const row = testDb.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  if (!row || row.value === null || row.value === undefined) return fallback;
  return row.value;
}
function getCenterSetting(centerId: number, key: string, fallback = ''): string {
  const row = testDb
    .prepare('SELECT value FROM center_settings WHERE center_id = ? AND key = ?')
    .get(centerId, key) as { value: string | null } | undefined;
  if (row && row.value !== null && row.value !== undefined) return row.value;
  return getSetting(key, fallback);
}

// Poison module cache: mọi `require('../../db')` sau đây nhận testDb
const dbModulePath: string = require.resolve('../../db');
(require.cache as unknown as Record<string, unknown>)[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { db: testDb, getSetting, getCenterSetting, confirmedPaid, recalcInvoiceStatus },
} as never;

// ---------------------------------------------------------------------------
// 2. Load services (SAU khi poison)
// ---------------------------------------------------------------------------
const invoicesService = require('./invoices.service') as typeof import('./invoices.service');
const paymentsService = require('../payments/payments.service') as typeof import('../payments/payments.service');
const parentService = require('../parent/parent.service') as typeof import('../parent/parent.service');

// ---------------------------------------------------------------------------
// 3. Fixtures
// ---------------------------------------------------------------------------
let centerId = 1;
let studentId = 0;
let parentId = 0;

function resetDb(): void {
  const tables = [
    'payment_txns', 'payments', 'invoices', 'credits', 'referrals',
    'reminders', 'parent_students', 'parents', 'enrollments', 'students', 'classes',
  ];
  for (const t of tables) testDb.prepare(`DELETE FROM ${t}`).run();

  centerId = Number(testDb.prepare("INSERT INTO centers (name) VALUES ('Trung tâm Test')").run().lastInsertRowid);
  const classId = Number(
    testDb.prepare('INSERT INTO classes (name, center_id) VALUES (?, ?)').run('Lớp Test', centerId).lastInsertRowid
  );
  studentId = Number(
    testDb.prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)').run('ST001', 'Học viên 1', centerId)
      .lastInsertRowid
  );
  testDb.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classId);
  parentId = Number(
    testDb.prepare("INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000001', 'x', 'PH 1', ?)")
      .run(centerId).lastInsertRowid
  );
  testDb.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parentId, studentId);
}

function createInvoice(amount = 1000000): number {
  const inv = invoicesService.createInvoice(centerId, { student_id: studentId, amount }) as { id: number };
  return inv.id;
}

function count(table: string, where = ''): number {
  return (testDb.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get() as { c: number }).c;
}

function invoiceStatus(id: number): string {
  return (testDb.prepare('SELECT status FROM invoices WHERE id = ?').get(id) as { status: string }).status;
}

// ---------------------------------------------------------------------------
// 4. Tests
// ---------------------------------------------------------------------------

describe('invoices.service - createInvoice', () => {
  beforeEach(resetDb);

  it('tạo hóa đơn hợp lệ', () => {
    const inv = invoicesService.createInvoice(centerId, {
      student_id: studentId,
      amount: 1500000,
      due_date: '2026-12-31',
      note: 'Học phí T12',
    }) as { id: number; amount: number; status: string };
    assert.ok(inv.id > 0);
    assert.equal(inv.amount, 1500000);
    assert.equal(inv.status, 'unpaid');
  });

  it('số tiền <= 0 → throw', () => {
    assert.throws(() => invoicesService.createInvoice(centerId, { student_id: studentId, amount: 0 }), /lớn hơn 0/);
    assert.throws(() => invoicesService.createInvoice(centerId, { student_id: studentId, amount: -500 }), /lớn hơn 0/);
    assert.equal(count('invoices'), 0);
  });

  it('học viên không tồn tại → throw 404', () => {
    assert.throws(
      () => invoicesService.createInvoice(centerId, { student_id: 99999, amount: 1000 }),
      /Không tìm thấy học viên/
    );
  });

  it('học viên khác center → throw 404 (chống lộ dữ liệu)', () => {
    const otherCenter = Number(testDb.prepare("INSERT INTO centers (name) VALUES ('TT khác')").run().lastInsertRowid);
    assert.throws(
      () => invoicesService.createInvoice(otherCenter, { student_id: studentId, amount: 1000 }),
      /Không tìm thấy học viên/
    );
  });
});

describe('invoices.service - recordPayment (thu tiền)', () => {
  beforeEach(resetDb);

  it('thu đủ → status paid', () => {
    const id = createInvoice(1000000);
    const r = invoicesService.recordPayment(centerId, id, { amount: 1000000, method: 'Tiền mặt' });
    assert.equal(r.status, 'paid');
    assert.equal(invoiceStatus(id), 'paid');
    assert.equal(confirmedPaid(id), 1000000);
  });

  it('thu một phần → status partial, công nợ đúng', () => {
    const id = createInvoice(1000000);
    const r = invoicesService.recordPayment(centerId, id, { amount: 400000 });
    assert.equal(r.status, 'partial');
    assert.equal(confirmedPaid(id), 400000);
    // Thu nốt
    const r2 = invoicesService.recordPayment(centerId, id, { amount: 600000 });
    assert.equal(r2.status, 'paid');
    assert.equal(confirmedPaid(id), 1000000);
  });

  it('thu vượt số còn nợ → throw, không ghi payment', () => {
    const id = createInvoice(1000000);
    invoicesService.recordPayment(centerId, id, { amount: 600000 });
    assert.throws(
      () => invoicesService.recordPayment(centerId, id, { amount: 500000 }),
      /vượt quá số còn nợ/
    );
    assert.equal(count('payments'), 1);
    assert.equal(confirmedPaid(id), 600000);
  });

  it('payment pending KHÔNG tính vào công nợ đã thu', () => {
    const id = createInvoice(1000000);
    // Phụ huynh báo đã chuyển khoản → pending
    parentService.claimPaid(parentId, id);
    assert.equal(confirmedPaid(id), 0);
    assert.equal(invoiceStatus(id), 'unpaid');
  });

  it('số tiền âm → throw', () => {
    const id = createInvoice(1000000);
    assert.throws(() => invoicesService.recordPayment(centerId, id, { amount: -100 }), /lớn hơn 0/);
  });
});

describe('payments.service - duyệt/từ chối', () => {
  beforeEach(resetDb);

  it('duyệt payment pending → confirmed, recalc status', () => {
    const id = createInvoice(1000000);
    const { payment_id } = parentService.claimPaid(parentId, id);
    const r = paymentsService.approvePendingPayment(payment_id);
    assert.equal(r.status, 'paid');
    assert.equal(confirmedPaid(id), 1000000);
    assert.equal(invoiceStatus(id), 'paid');
  });

  it('duyệt payment đã duyệt rồi → throw 404', () => {
    const id = createInvoice(1000000);
    const { payment_id } = parentService.claimPaid(parentId, id);
    paymentsService.approvePendingPayment(payment_id);
    assert.throws(() => paymentsService.approvePendingPayment(payment_id), /đang chờ duyệt/);
  });

  it('từ chối payment → rejected, công nợ không đổi', () => {
    const id = createInvoice(1000000);
    const { payment_id } = parentService.claimPaid(parentId, id);
    paymentsService.rejectPendingPayment(payment_id);
    const st = (testDb.prepare('SELECT status FROM payments WHERE id = ?').get(payment_id) as { status: string }).status;
    assert.equal(st, 'rejected');
    assert.equal(confirmedPaid(id), 0);
    assert.equal(invoiceStatus(id), 'unpaid');
  });

  it('duyệt payment không tồn tại → throw 404', () => {
    assert.throws(() => paymentsService.approvePendingPayment(99999), /đang chờ duyệt/);
  });

  it('listPendingPayments chỉ liệt kê pending', () => {
    const id1 = createInvoice(1000000);
    const id2 = createInvoice(500000);
    const p1 = parentService.claimPaid(parentId, id1);
    parentService.claimPaid(parentId, id2);
    paymentsService.approvePendingPayment(p1.payment_id);
    const list = paymentsService.listPendingPayments(centerId) as { data: { invoice_id: number }[] };
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].invoice_id, id2);
  });
});

describe('parent.service - claimPaid (báo chuyển khoản)', () => {
  beforeEach(resetDb);

  it('báo chuyển khoản tạo payment pending đúng số còn nợ', () => {
    const id = createInvoice(1000000);
    const r = parentService.claimPaid(parentId, id);
    assert.equal(r.status, 'pending');
    const p = testDb.prepare('SELECT amount, method, status FROM payments WHERE id = ?').get(r.payment_id) as {
      amount: number;
      method: string;
      status: string;
    };
    assert.equal(p.amount, 1000000);
    assert.equal(p.method, 'bank_transfer');
    assert.equal(p.status, 'pending');
  });

  it('hóa đơn đã thu đủ → không cho báo nữa', () => {
    const id = createInvoice(1000000);
    invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    assert.throws(() => parentService.claimPaid(parentId, id), /đã thanh toán đủ/);
  });

  it('phụ huynh khác không báo được cho con người khác', () => {
    const id = createInvoice(1000000);
    const otherParent = Number(
      testDb.prepare("INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000002', 'x', 'PH 2', ?)")
        .run(centerId).lastInsertRowid
    );
    assert.throws(() => parentService.claimPaid(otherParent, id), /Không tìm thấy hóa đơn/);
  });
});

describe('invoices.service - công nợ & xóa', () => {
  beforeEach(resetDb);

  it('getDebtReport tính đúng total/paid/debt', () => {
    const id1 = createInvoice(1000000);
    createInvoice(500000);
    invoicesService.recordPayment(centerId, id1, { amount: 300000 });
    const report = invoicesService.getDebtReport(centerId) as {
      data: { id: number; total: number; paid: number; debt: number }[];
    };
    assert.equal(report.data.length, 1);
    const row = report.data[0];
    assert.equal(row.total, 1500000);
    assert.equal(row.paid, 300000);
    assert.equal(row.debt, 1200000);
  });

  it('hóa đơn đã paid không vào báo cáo nợ', () => {
    const id = createInvoice(1000000);
    invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    const report = invoicesService.getDebtReport(centerId) as { data: unknown[] };
    assert.equal(report.data.length, 0);
    const summary = invoicesService.getDebtSummary(centerId);
    assert.equal(summary.totalDebt, 0);
    assert.equal(summary.debtorCount, 0);
  });

  it('xóa hóa đơn cascade xóa payments', () => {
    const id = createInvoice(1000000);
    invoicesService.recordPayment(centerId, id, { amount: 200000 });
    invoicesService.deleteInvoice(centerId, id);
    assert.equal(count('invoices', `WHERE id = ${id}`), 0);
    assert.equal(count('payments', `WHERE invoice_id = ${id}`), 0);
  });

  it('update hóa đơn recalc status', () => {
    const id = createInvoice(1000000);
    invoicesService.recordPayment(centerId, id, { amount: 1000000 });
    assert.equal(invoiceStatus(id), 'paid');
    // Giảm amount xuống dưới số đã thu → vẫn paid (không âm nợ)
    invoicesService.updateInvoice(centerId, id, { amount: 800000 });
    assert.equal(invoiceStatus(id), 'paid');
  });
});
