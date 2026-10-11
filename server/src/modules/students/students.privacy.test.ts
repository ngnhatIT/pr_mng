/**
 * Quyền dữ liệu cá nhân (DB thật, v31): xuất đủ các phần dữ liệu; ẩn danh xóa thông tin định danh + liên kết
 * phụ huynh + nội dung nhắc nhưng giữ hóa đơn/thanh toán/điểm danh; không ẩn danh 2 lần; khác trung tâm -> 404.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { anonymizeStudent, exportStudentData } from './students.privacy';

let centerId = 0;
let studentId = 0;
const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const one = async (sql: string, ...p: unknown[]) =>
  (await db.prepare(sql).get(...p)) as Record<string, unknown>;

before(async () => {
  await setupTestDb();
  await resetTestDb();
  centerId = await id("INSERT INTO centers (name) VALUES ('TT')");
  studentId = await id(
    "INSERT INTO students (code, name, phone, email, dob, center_id) VALUES ('HV1', 'Nguyễn An', '0901', 'an@ex.com', '2012-01-02', ?)",
    centerId
  );
  const cls = await id("INSERT INTO classes (name, center_id) VALUES ('Lớp', ?)", centerId);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, cls);
  const sess = await id("INSERT INTO sessions (class_id, date) VALUES (?, '2026-10-01')", cls);
  await db
    .prepare("INSERT INTO attendance (session_id, student_id, status, note) VALUES (?, ?, 'absent', 'ốm')")
    .run(sess, studentId);
  const inv = await id(
    'INSERT INTO invoices (student_id, amount, center_id) VALUES (?, 500000, ?)',
    studentId,
    centerId
  );
  await db.prepare("INSERT INTO payments (invoice_id, amount, method) VALUES (?, 500000, 'cash')").run(inv);
  const parent = await id(
    "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0909', 'x', 'PH', ?)",
    centerId
  );
  await db.prepare('INSERT INTO parent_students VALUES (?, ?)').run(parent, studentId);
  await db
    .prepare(
      "INSERT INTO reminders (student_id, phone, kind, status, message) VALUES (?, '0909', 'absence', 'demo', 'Nguyễn An vắng')"
    )
    .run(studentId);
  await db
    .prepare(
      "INSERT INTO notifications (center_id, recipient_type, recipient_id, kind, params, body) VALUES (?, 'parent', ?, 'absence', ?::jsonb, 'Nguyễn An vắng')"
    )
    .run(centerId, parent, JSON.stringify({ student: 'Nguyễn An', student_id: studentId }));
});
after(teardownTestDb);

describe('quyền dữ liệu cá nhân', () => {
  it('xuất đủ các phần, khác trung tâm -> 404', async () => {
    const d = (await exportStudentData(centerId, studentId)) as Record<string, unknown[]> & {
      student: { name: string };
    };
    assert.equal(d.student.name, 'Nguyễn An');
    for (const k of ['enrollments', 'attendance', 'invoices', 'payments', 'parents', 'notices']) {
      assert.equal(d[k].length, 1, k);
    }
    await assert.rejects(exportStudentData(centerId + 999, studentId), { statusCode: 404 });
  });

  it('ẩn danh: xóa định danh, gỡ phụ huynh, giữ tài chính + điểm danh; không làm 2 lần', async () => {
    await anonymizeStudent(centerId, studentId);
    const st = await one(
      'SELECT name, phone, email, dob, status, anonymized_at FROM students WHERE id = ?',
      studentId
    );
    assert.equal(st.name, `Học viên đã ẩn danh #${studentId}`);
    assert.deepEqual([st.phone, st.email, st.dob, st.status], [null, null, null, 'quit']);
    assert.ok(st.anonymized_at);
    assert.equal(
      Number((await one('SELECT COUNT(*) c FROM parent_students WHERE student_id = ?', studentId)).c),
      0
    );
    assert.equal((await one('SELECT message FROM reminders WHERE student_id = ?', studentId)).message, null);
    assert.equal((await one('SELECT note FROM attendance WHERE student_id = ?', studentId)).note, null);
    assert.equal(Number((await one('SELECT COUNT(*) c FROM invoices WHERE student_id = ?', studentId)).c), 1);
    assert.equal(
      Number((await one('SELECT COUNT(*) c FROM attendance WHERE student_id = ?', studentId)).c),
      1
    );
    const n = await one('SELECT body, params FROM notifications');
    assert.equal(n.body, null);
    assert.equal((n.params as { student: string }).student, `#${studentId}`);
    await assert.rejects(anonymizeStudent(centerId, studentId), { code: 'ALREADY_ANONYMIZED' });
  });
});
