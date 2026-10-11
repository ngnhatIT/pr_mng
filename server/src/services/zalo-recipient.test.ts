/**
 * Test H3: ZNS gửi đúng đối tượng (SĐT phụ huynh, fallback SĐT học viên),
 * bỏ qua học viên đã nghỉ học (status='quit').
 * Dùng demo mode (chưa cấu hình access token) để không gọi Zalo thật —
 * result.phone cho biết SĐT nào sẽ được gửi.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../db/test-utils';
import { sendTuitionReminder } from './zalo';
import * as invoicesService from '../modules/invoices/invoices.service';

let centerId = 0;

async function makeStudent(name: string, phone: string | null, status = 'studying'): Promise<number> {
  const r = await db
    .prepare('INSERT INTO students (code, name, phone, center_id, status) VALUES (?, ?, ?, ?, ?)')
    .run('HV' + Math.random().toString(36).slice(2, 8), name, phone, centerId, status);
  return Number(r.lastInsertRowid);
}

async function makeParent(phone: string): Promise<number> {
  const r = await db
    .prepare('INSERT INTO parents (phone, password_hash, name, center_id) VALUES (?, ?, ?, ?)')
    .run(phone, 'x', 'PH', centerId);
  return Number(r.lastInsertRowid);
}

async function makeInvoice(studentId: number): Promise<number> {
  const inv = (await invoicesService.createInvoice(centerId, { student_id: studentId, amount: 1000000 })) as {
    id: number;
  };
  return inv.id;
}

before(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  const c = await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run();
  centerId = Number(c.lastInsertRowid);
});
after(async () => {
  await teardownTestDb();
});

describe('H3: ZNS gửi đúng SĐT phụ huynh', () => {
  it('ưu tiên SĐT phụ huynh liên kết, không dùng SĐT học viên', async () => {
    const sid = await makeStudent('HV A', '0911111111');
    const pid = await makeParent('0922222222');
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(pid, sid);
    const invId = await makeInvoice(sid);
    const r = await sendTuitionReminder(invId, 'overdue', centerId);
    assert.equal(r.status, 'demo');
    assert.equal(r.phone, '0922222222', 'phải gửi cho phụ huynh');
  });

  it('chưa liên kết phụ huynh -> fallback SĐT học viên', async () => {
    const sid = await makeStudent('HV B', '0933333333');
    const invId = await makeInvoice(sid);
    const r = await sendTuitionReminder(invId, 'overdue', centerId);
    assert.equal(r.status, 'demo');
    assert.equal(r.phone, '0933333333');
  });

  it('học viên đã nghỉ học (quit) -> không nhắc', async () => {
    const sid = await makeStudent('HV C', '0944444444', 'quit');
    const invId = await makeInvoice(sid);
    const r = await sendTuitionReminder(invId, 'overdue', centerId);
    assert.equal(r.status, 'failed');
    assert.match(r.message, /nghỉ học/);
  });
});
