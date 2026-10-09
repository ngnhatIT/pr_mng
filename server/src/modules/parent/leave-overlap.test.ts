/**
 * Test đơn xin nghỉ không trùng ngày:
 * - Tạo đơn thứ 2 giao nhau với đơn pending/approved -> 409
 * - Đơn không giao nhau -> OK
 * - Đơn sau khi bị reject thì được tạo lại khoảng ngày đó
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { createLeave } from './parent.service';
import { AppError } from '../../shared/errors';

function future(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('createLeave - chống trùng ngày (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
    await db
      .prepare(
        "INSERT INTO parents (id, center_id, phone, password_hash, name) VALUES (1, 1, '0900000001', 'x', 'PH')"
      )
      .run();
    await db.prepare("INSERT INTO students (id, code, name, center_id) VALUES (1, 'HV1', 'A', 1)").run();
    await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (1, 1)').run();
  });
  after(async () => {
    await teardownTestDb();
  });

  it('đơn giao nhau với đơn pending -> 409', async () => {
    await createLeave(1, { student_id: 1, from_date: future(5), to_date: future(7) });
    await assert.rejects(
      () => createLeave(1, { student_id: 1, from_date: future(6), to_date: future(8) }),
      (e: unknown) => e instanceof AppError && e.statusCode === 409
    );
  });

  it('đơn không giao nhau -> OK', async () => {
    await createLeave(1, { student_id: 1, from_date: future(5), to_date: future(7) });
    const r = await createLeave(1, { student_id: 1, from_date: future(10), to_date: future(12) });
    assert.equal(r.status, 'pending');
  });

  it('đơn cũ bị reject thì được tạo lại khoảng ngày đó', async () => {
    const r1 = await createLeave(1, { student_id: 1, from_date: future(5), to_date: future(7) });
    await db.prepare("UPDATE leave_requests SET status = 'rejected' WHERE id = ?").run(r1.id);
    const r2 = await createLeave(1, { student_id: 1, from_date: future(5), to_date: future(7) });
    assert.equal(r2.status, 'pending');
  });
});
