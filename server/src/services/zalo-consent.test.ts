/**
 * Test H5: consent ZNS của phụ huynh.
 * - Migration v15: cột parents.zalo_consent tồn tại, default 'unknown',
 *   CHECK chỉ cho granted/denied/unknown.
 * - getZaloConsent/setZaloConsent: roundtrip; giá trị lạ -> throw.
 * - sendTuitionReminder bỏ qua phụ huynh denied (không gửi, kể cả demo).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../db/test-utils';
import { sendTuitionReminder } from './zalo';
import { getZaloConsent, setZaloConsent } from '../modules/parent/parent.service';
import * as invoicesService from '../modules/invoices/invoices.service';

let centerId = 0;
let parentId = 0;
let studentId = 0;

before(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  const c = await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run();
  centerId = Number(c.lastInsertRowid);
  const p = await db
    .prepare('INSERT INTO parents (phone, password_hash, name, center_id) VALUES (?, ?, ?, ?)')
    .run('0922222222', 'x', 'PH', centerId);
  parentId = Number(p.lastInsertRowid);
  const s = await db
    .prepare("INSERT INTO students (code, name, phone, center_id, status) VALUES (?, ?, ?, ?, 'studying')")
    .run('HV1', 'HV A', '0911111111', centerId);
  studentId = Number(s.lastInsertRowid);
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parentId, studentId);
});
after(async () => {
  await teardownTestDb();
});

describe('H5: migration + consent API', () => {
  it('cột zalo_consent tồn tại, default unknown', async () => {
    const row = (await db.prepare('SELECT zalo_consent FROM parents WHERE id = ?').get(parentId)) as {
      zalo_consent: string;
    };
    assert.equal(row.zalo_consent, 'unknown');
  });

  it('CHECK constraint chặn giá trị lạ', async () => {
    await assert.rejects(db.prepare('UPDATE parents SET zalo_consent = ? WHERE id = ?').run('yes', parentId));
  });

  it('get/set consent roundtrip; giá trị lạ -> throw', async () => {
    assert.equal(await getZaloConsent(parentId), 'unknown');
    assert.equal(await setZaloConsent(parentId, 'denied'), 'denied');
    assert.equal(await getZaloConsent(parentId), 'denied');
    assert.equal(await setZaloConsent(parentId, 'granted'), 'granted');
    await assert.rejects(() => setZaloConsent(parentId, 'maybe'));
  });
});

describe('H5: scheduler bỏ qua phụ huynh denied', () => {
  it('denied -> sendTuitionReminder failed, không gửi', async () => {
    await setZaloConsent(parentId, 'denied');
    const inv = (await invoicesService.createInvoice(centerId, {
      student_id: studentId,
      amount: 1000000,
    })) as {
      id: number;
    };
    const r = await sendTuitionReminder(inv.id, 'overdue', centerId);
    assert.equal(r.status, 'failed');
    assert.match(r.message, /từ chối/);
    // Không ghi log nhắc 'demo'/'sending' nào cho lần bỏ qua này ngoài 1 dòng failed
    const logs = (await db
      .prepare("SELECT status FROM reminders WHERE invoice_id = ? AND kind = 'overdue'")
      .all(inv.id)) as { status: string }[];
    assert.ok(logs.length > 0 && logs.every((l) => l.status === 'failed'));
  });

  it('granted/unknown -> vẫn nhắc bình thường (demo)', async () => {
    const inv = (await invoicesService.createInvoice(centerId, {
      student_id: studentId,
      amount: 1000000,
    })) as {
      id: number;
    };
    const r = await sendTuitionReminder(inv.id, 'overdue', centerId);
    assert.equal(r.status, 'demo');
    assert.equal(r.phone, '0922222222');
  });
});
