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

describe('trials.convert - sĩ số & referral', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lớp đã đủ sĩ số -> 400, rollback (không tạo học viên, trial vẫn new)', async () => {
    const cls = Number(
      (
        await db
          .prepare("INSERT INTO classes (name, center_id, max_students) VALUES ('Full', ?, 1)")
          .run(centerA)
      ).lastInsertRowid
    );
    const other = Number(
      (await db.prepare("INSERT INTO students (code, name, center_id) VALUES ('X1', 'X', ?)").run(centerA))
        .lastInsertRowid
    );
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(other, cls);
    await assert.rejects(
      () => trialsService.convertTrial(centerA, trialId, cls),
      (e: unknown) => e instanceof AppError && e.statusCode === 400
    );
    assert.equal(await studentCount(centerA), 1); // chỉ học viên X có sẵn
    assert.equal(await trialStatus(trialId), 'new');
  });

  it('chỉ gắn referral của đúng mã giới thiệu trong cùng trung tâm', async () => {
    const pB = Number(
      (
        await db
          .prepare(
            "INSERT INTO parents (center_id, phone, password_hash, name, referral_code) VALUES (?, '0900000001', 'x', 'PB', 'REFB')"
          )
          .run(centerB)
      ).lastInsertRowid
    );
    const pA = Number(
      (
        await db
          .prepare(
            "INSERT INTO parents (center_id, phone, password_hash, name, referral_code) VALUES (?, '0900000002', 'x', 'PA', 'REFA')"
          )
          .run(centerA)
      ).lastInsertRowid
    );
    const ins = db.prepare(
      "INSERT INTO referrals (referrer_parent_id, referred_phone, center_id, status) VALUES (?, '0912345678', ?, 'pending')"
    );
    const rB = Number((await ins.run(pB, centerB)).lastInsertRowid);
    const rA = Number((await ins.run(pA, centerA)).lastInsertRowid);
    await db.prepare("UPDATE trial_registrations SET referral_code = 'REFA' WHERE id = ?").run(trialId);
    const { student_id } = await trialsService.convertTrial(centerA, trialId, null);
    const get = async (id: number) =>
      (
        (await db.prepare('SELECT referred_student_id FROM referrals WHERE id = ?').get(id)) as {
          referred_student_id: number | null;
        }
      ).referred_student_id;
    assert.equal(await get(rA), student_id);
    assert.equal(await get(rB), null);
  });
});
