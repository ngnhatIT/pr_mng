/**
 * v28 (DB thật): dòng hóa đơn + giảm trừ (amount = tổng dòng - giảm trừ), kỳ thu không trùng, client cũ chỉ gửi
 * amount vẫn chạy, tạo hóa đơn tháng hàng loạt: xem trước không ghi, chạy lại không nhân đôi, chỉ học viên đang học.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import * as svc from './invoices.service';

let centerId = 0;
let classId = 0;
let studentId = 0;

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const count = async (sql: string, ...p: unknown[]) =>
  Number(((await db.prepare(sql).get(...p)) as { c: number | string }).c);

before(setupTestDb);
after(teardownTestDb);

beforeEach(async () => {
  await resetTestDb();
  centerId = await id("INSERT INTO centers (name) VALUES ('TT')");
  classId = await id(
    "INSERT INTO classes (name, center_id, tuition_fee) VALUES ('IELTS', ?, 2000000)",
    centerId
  );
  studentId = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'An', ?)", centerId);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classId);
});

describe('dòng hóa đơn + giảm trừ', () => {
  it('amount = tổng dòng - giảm trừ; chi tiết trả dòng đúng thứ tự', async () => {
    const inv = (await svc.createInvoice(centerId, {
      student_id: studentId,
      class_id: classId,
      items: [
        { description: 'Học phí tháng 10', quantity: 1, unit_price: 2000000 },
        { description: 'Giáo trình', quantity: 2, unit_price: 150000 },
      ],
      discount_amount: 200000,
      discount_reason: 'Anh chị em',
      period: '2026-10',
    })) as { id: number; amount: number; discount_amount: number };
    assert.equal(inv.amount, 2100000);
    assert.equal(inv.discount_amount, 200000);
    const detail = (await svc.getInvoiceDetail(centerId, inv.id)) as { items: { description: string }[] };
    assert.deepEqual(
      detail.items.map((i) => i.description),
      ['Học phí tháng 10', 'Giáo trình']
    );
  });

  it('chặn giảm trừ >= tạm tính, dòng sai, kỳ thu trùng', async () => {
    const base = { student_id: studentId, class_id: classId };
    await assert.rejects(svc.createInvoice(centerId, { ...base, amount: 100, discount_amount: 100 }), {
      code: 'INVALID_DISCOUNT',
    });
    await assert.rejects(
      svc.createInvoice(centerId, { ...base, items: [{ description: ' ', quantity: 1, unit_price: 5 }] }),
      { code: 'INVALID_ITEMS' }
    );
    await svc.createInvoice(centerId, { ...base, amount: 500000, period: '2026-11' });
    await assert.rejects(svc.createInvoice(centerId, { ...base, amount: 500000, period: '2026-11' }), {
      code: 'INVOICE_PERIOD_EXISTS',
    });
  });

  it('client cũ chỉ gửi amount: đổi số tiền thì bỏ dòng cũ; gửi items thì thay toàn bộ', async () => {
    const inv = (await svc.createInvoice(centerId, {
      student_id: studentId,
      items: [{ description: 'A', quantity: 1, unit_price: 300000 }],
    })) as { id: number };
    await svc.updateInvoice(centerId, inv.id, { amount: 300000, note: 'giữ nguyên' });
    assert.equal(await count('SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?', inv.id), 1);
    await svc.updateInvoice(centerId, inv.id, { amount: 350000 });
    assert.equal(await count('SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?', inv.id), 0);
    const up = (await svc.updateInvoice(centerId, inv.id, {
      items: [
        { description: 'B', quantity: 3, unit_price: 100000 },
        { description: 'C', quantity: 1, unit_price: 50000 },
      ],
    })) as { amount: number };
    assert.equal(up.amount, 350000);
    assert.equal(await count('SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?', inv.id), 2);
  });
});

describe('hóa đơn tháng hàng loạt', () => {
  it('xem trước không ghi; tạo đúng học viên đang học; chạy lại bỏ qua', async () => {
    const paused = await id(
      "INSERT INTO students (code, name, center_id, status) VALUES ('HV2', 'B', ?, 'paused')",
      centerId
    );
    const left = await id("INSERT INTO students (code, name, center_id) VALUES ('HV3', 'C', ?)", centerId);
    const free = await id(
      "INSERT INTO classes (name, center_id, tuition_fee) VALUES ('CLB', ?, 0)",
      centerId
    );
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(paused, classId);
    await db
      .prepare("INSERT INTO enrollments (student_id, class_id, status) VALUES (?, ?, 'inactive')")
      .run(left, classId);
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, free);

    const preview = await svc.generateMonthlyInvoices(centerId, { period: '2026-10', dry_run: true });
    assert.deepEqual([preview.created, preview.skipped, preview.total], [1, 0, 2000000]);
    assert.equal(await count('SELECT COUNT(*) AS c FROM invoices'), 0);

    const run = await svc.generateMonthlyInvoices(centerId, { period: '2026-10', due_date: '2026-10-10' });
    assert.deepEqual([run.created, run.total], [1, 2000000]);
    const item = (await db.prepare('SELECT description FROM invoice_items').get()) as { description: string };
    assert.equal(item.description, 'Học phí IELTS tháng 10/2026');

    const again = await svc.generateMonthlyInvoices(centerId, { period: '2026-10' });
    assert.deepEqual([again.created, again.skipped], [0, 1]);
    assert.equal(await count('SELECT COUNT(*) AS c FROM invoices'), 1);
    await assert.rejects(svc.generateMonthlyInvoices(centerId, { period: '2026-13' }), { statusCode: 400 });
  });
});
