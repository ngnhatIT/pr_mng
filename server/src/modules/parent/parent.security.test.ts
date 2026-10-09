/**
 * Security test: parent A không được đọc dữ liệu học viên của parent B.
 * Regression test cho bug thiếu `await getLinkedStudent(...)` — promise reject
 * bị trôi, hàm vẫn trả dữ liệu (leak cross-parent).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import * as parentService from './parent.service';

let centerA = 0;
let centerB = 0;
let parentA = 0;
let studentA = 0;
let studentB = 0;

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
  const sb = await db
    .prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)')
    .run('HVB1', 'HV B', centerB);
  studentB = Number(sb.lastInsertRowid);

  const pa = await db
    .prepare(
      "INSERT INTO parents (phone, password_hash, name, center_id) VALUES ('0900000001', 'x', 'PH A', ?)"
    )
    .run(centerA);
  parentA = Number(pa.lastInsertRowid);
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parentA, studentA);
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('parent.security - cross-parent isolation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('getChildOverview(parentA, studentB) -> throw 404', async () => {
    await assert.rejects(
      () => parentService.getChildOverview(parentA, studentB),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });

  it('getChildOverview(parentA, studentA) -> thành công', async () => {
    const overview = await parentService.getChildOverview(parentA, studentA);
    assert.ok(overview && typeof overview === 'object');
  });

  it('listChildGrades(parentA, studentB) -> throw 404', async () => {
    await assert.rejects(
      () => parentService.listChildGrades(parentA, studentB),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });

  it('getChildSubmissions(parentA, studentB, hw) -> throw 404', async () => {
    await assert.rejects(
      () => parentService.getChildSubmissions(parentA, studentB, 999999),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });
});
