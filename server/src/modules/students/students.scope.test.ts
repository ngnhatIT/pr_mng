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
