/**
 * Scope test: staff center A không được đọc/sửa học viên của center B.
 * Regression test cho bug thiếu `await findByIdOr404(...)` — check center
 * bị trôi, UPDATE vẫn chạy (cross-center write).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import * as studentsService from './students.service';

let centerA = 0;
let centerB = 0;
let studentA = 0;

async function resetDb(): Promise<void> {
  await resetTestDb();

  const ca = await db.prepare("INSERT INTO centers (name) VALUES ('TT A')").run();
  centerA = Number(ca.lastInsertRowid);
  const cb = await db.prepare("INSERT INTO centers (name) VALUES ('TT B')").run();
  centerB = Number(cb.lastInsertRowid);

  const sa = await db
    .prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)')
    .run('HVA1', 'HV A', centerA);
  studentA = Number(sa.lastInsertRowid);
}

async function studentName(id: number): Promise<string> {
  const row = (await db.prepare('SELECT name FROM students WHERE id = ?').get(id)) as { name: string };
  return row.name;
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('students.scope - cross-center isolation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('updateStudent(centerB, studentA) -> throw 404 và KHÔNG đổi dữ liệu', async () => {
    await assert.rejects(
      () => studentsService.updateStudent(centerB, studentA, { name: 'Bị sửa trộm' }),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
    assert.equal(await studentName(studentA), 'HV A');
  });

  it('updateStudent(centerA, studentA) -> thành công', async () => {
    const updated = (await studentsService.updateStudent(centerA, studentA, { name: 'HV A mới' })) as {
      name: string;
    };
    assert.equal(updated.name, 'HV A mới');
  });

  it('getStudentDetail(centerB, studentA) -> throw 404', async () => {
    await assert.rejects(
      () => studentsService.getStudentDetail(centerB, studentA),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });

  it('getStudentDetail(centerA, studentA) -> thành công', async () => {
    const detail = await studentsService.getStudentDetail(centerA, studentA);
    assert.equal((detail.student as { name: string }).name, 'HV A');
  });
});

describe('students.scope - own scope (giáo viên) & mã học viên', () => {
  let teacherId = 0;
  let classId = 0;

  beforeEach(async () => {
    await resetDb();
    teacherId = Number(
      (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV', ?)").run(centerA))
        .lastInsertRowid
    );
    classId = Number(
      (
        await db
          .prepare("INSERT INTO classes (name, center_id, teacher_id) VALUES ('L', ?, ?)")
          .run(centerA, teacherId)
      ).lastInsertRowid
    );
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentA, classId);
    await db
      .prepare("INSERT INTO invoices (student_id, class_id, amount, status) VALUES (?, ?, 100000, 'unpaid')")
      .run(studentA, classId);
  });

  it('scope own + teacher_id null -> không thấy học viên nào (fail-closed)', async () => {
    const r = await studentsService.listStudents(centerA, {}, {}, { ownOnly: true, teacherId: null });
    assert.equal(r.pagination.total, 0);
    await assert.rejects(
      () => studentsService.getStudentDetail(centerA, studentA, { ownOnly: true, teacherId: null }),
      (e: unknown) => e instanceof AppError && e.statusCode === 403
    );
  });

  it('scope own chỉ thấy học viên enrollment active; không có invoices.view thì không trả hóa đơn', async () => {
    const own = { ownOnly: true, teacherId };
    assert.equal((await studentsService.listStudents(centerA, {}, {}, own)).pagination.total, 1);
    const detail = await studentsService.getStudentDetail(centerA, studentA, own);
    assert.equal(detail.invoices, undefined);
    const staff = await studentsService.getStudentDetail(centerA, studentA, { canViewInvoices: true });
    assert.equal((staff.invoices as unknown[]).length, 1);
    await db.prepare("UPDATE enrollments SET status = 'inactive' WHERE student_id = ?").run(studentA);
    assert.equal((await studentsService.listStudents(centerA, {}, {}, own)).pagination.total, 0);
  });

  it('mã tự sinh theo trung tâm, đồng thời không trùng; mã tay trùng ở center khác vẫn được', async () => {
    const created = (await Promise.all(
      [1, 2, 3].map((i) => studentsService.createStudent(centerA, { name: `HS ${i}` }))
    )) as { code: string }[];
    assert.equal(new Set(created.map((c) => c.code)).size, 3);
    const b = (await studentsService.createStudent(centerB, { code: 'HVA1', name: 'HS B' })) as {
      code: string;
    };
    assert.equal(b.code, 'HVA1');
    await assert.rejects(
      () => studentsService.createStudent(centerA, { code: 'HVA1', name: 'Trùng' }),
      (e: unknown) => e instanceof AppError && e.statusCode === 409
    );
  });
});
