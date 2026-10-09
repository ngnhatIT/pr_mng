/**
 * Test convert đăng ký học thử -> học viên:
 * convert 2 lần phải 409 ở lần 2 (không tạo trùng học viên).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import * as trialsService from './trials.service';

let centerA = 0;
let centerB = 0;
let trialId = 0;

async function resetDb(): Promise<void> {
  await resetTestDb();

  const ca = await db.prepare("INSERT INTO centers (name) VALUES ('TT A')").run();
  centerA = Number(ca.lastInsertRowid);
  const cb = await db.prepare("INSERT INTO centers (name) VALUES ('TT B')").run();
  centerB = Number(cb.lastInsertRowid);

  const tr = await db
    .prepare('INSERT INTO trial_registrations (name, phone, center_id, status) VALUES (?, ?, ?, ?)')
    .run('Nguyễn Văn Thử', '0912345678', centerA, 'new');
  trialId = Number(tr.lastInsertRowid);
}

async function studentCount(center: number): Promise<number> {
  const r = (await db.prepare('SELECT COUNT(*)::int as c FROM students WHERE center_id = ?').get(center)) as {
    c: number;
  };
  return r.c;
}

async function trialStatus(id: number): Promise<string> {
  const r = (await db.prepare('SELECT status FROM trial_registrations WHERE id = ?').get(id)) as {
    status: string;
  };
  return r.status;
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('trials.convert - idempotency', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('convert lần 1 thành công, trial chuyển sang converted', async () => {
    const r = await trialsService.convertTrial(centerA, trialId, null);
    assert.ok(r.student_id > 0);
    assert.equal(await trialStatus(trialId), 'converted');
    assert.equal(await studentCount(centerA), 1);
  });

  it('convert 2 lần đồng thời -> chỉ 1 thành công, không trùng học viên', async () => {
    const results = await Promise.allSettled([
      trialsService.convertTrial(centerA, trialId, null),
      trialsService.convertTrial(centerA, trialId, null),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail409 = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof AppError && r.reason.statusCode === 409
    ).length;
    assert.equal(ok, 1, 'chỉ 1 lượt convert thành công');
    assert.equal(fail409, 1, 'lượt còn lại phải 409');
    assert.equal(await studentCount(centerA), 1, 'không tạo trùng học viên');
  });

  it('convert lần 2 -> throw 409 và không tạo thêm học viên', async () => {
    await trialsService.convertTrial(centerA, trialId, null);
    await assert.rejects(
      () => trialsService.convertTrial(centerA, trialId, null),
      (e: unknown) => e instanceof AppError && e.statusCode === 409
    );
    assert.equal(await studentCount(centerA), 1);
  });

  it('convert trial của center khác -> throw 404', async () => {
    await assert.rejects(
      () => trialsService.convertTrial(centerB, trialId, null),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });
});
