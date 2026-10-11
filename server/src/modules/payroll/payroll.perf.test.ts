/**
 * Regression test: index FK nóng (migration v7) + getCenterSettings batch + calcPayrollBulk.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils.js';
import { db } from '../../db/pg-compat.js';
import { getCenterSettings } from '../../db/helpers.js';
import { calcPayroll, calcPayrollBulk } from './payroll.service.js';

describe('Performance upgrades (audit 2026-10-09)', () => {
  let centerId: number;

  before(async () => {
    await setupTestDb();
    await resetTestDb();
    const r = await db.prepare('INSERT INTO centers (name) VALUES (?)').run('Perf Center');
    centerId = Number(r.lastInsertRowid);
  });

  after(async () => {
    await teardownTestDb();
  });

  it('đủ index FK nóng (v7; v23 bỏ bản trùng, giữ bản composite)', async () => {
    const expected = [
      'idx_payments_invoice_status',
      'idx_invoices_student_status',
      'idx_invoices_center',
      'idx_students_center_status',
      'idx_homework_class_status',
      'idx_quiz_attempts',
      'idx_leaves_student',
      'idx_sessions_date',
      'idx_txns_pending',
      'idx_txns_invoice',
    ];
    for (const name of expected) {
      const row = (await db.prepare('SELECT 1 as ok FROM pg_indexes WHERE indexname = ?').get(name)) as
        { ok: number } | undefined;
      assert.ok(row, `thiếu index ${name}`);
    }
  });

  it('getCenterSettings đọc batch 1 query, fallback đúng', async () => {
    await db
      .prepare('INSERT INTO center_settings (center_id, key, value) VALUES (?, ?, ?)')
      .run(centerId, 'pay_bank_code', 'VCB');
    const m = await getCenterSettings(centerId, ['pay_bank_code', 'pay_bank_account_no']);
    assert.equal(m.get('pay_bank_code'), 'VCB');
    assert.ok(m.has('pay_bank_account_no')); // thiếu -> fallback ''
  });

  it('calcPayrollBulk khớp calcPayroll từng giáo viên', async () => {
    // 2 giáo viên, 1 lớp, 1 buổi có điểm danh
    const t1 = Number(
      (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV A', ?)").run(centerId))
        .lastInsertRowid
    );
    const t2 = Number(
      (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV B', ?)").run(centerId))
        .lastInsertRowid
    );
    await db
      .prepare('INSERT INTO salary_rules (teacher_id, per_session_amount) VALUES (?, ?)')
      .run(t1, 200000);
    const cls = Number(
      (
        await db
          .prepare("INSERT INTO classes (name, center_id, teacher_id) VALUES ('Lop 1', ?, ?)")
          .run(centerId, t1)
      ).lastInsertRowid
    );
    const today = new Date().toISOString().slice(0, 10);
    const sess = Number(
      (
        await db
          .prepare('INSERT INTO sessions (class_id, date, teacher_id) VALUES (?, ?, ?)')
          .run(cls, today, t1)
      ).lastInsertRowid
    );
    const st = Number(
      (
        await db
          .prepare("INSERT INTO students (code, name, center_id) VALUES ('HVX1', 'HS 1', ?)")
          .run(centerId)
      ).lastInsertRowid
    );
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(st, cls);
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(sess, st);

    const month = today.slice(0, 7);
    const single = await calcPayroll(t1, month);
    const bulk = await calcPayrollBulk(centerId, month);
    const row1 = bulk.find((r: { teacher_id: number }) => r.teacher_id === t1);
    const row2 = bulk.find((r: { teacher_id: number }) => r.teacher_id === t2);
    assert.ok(row1 && row2, 'đủ 2 dòng');
    assert.equal(row1.sessions, single.sessions);
    assert.equal(row1.total, single.total);
    assert.equal(row1.total, 200000);
    assert.equal(row2.total, 0); // GV B không dạy buổi nào
  });
});
