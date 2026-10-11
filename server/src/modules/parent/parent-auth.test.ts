/**
 * SEC-4/SEC-6: liên kết con chống dò ngày sinh (khóa theo phụ huynh + theo mã HV, 1 lỗi chung),
 * resolvePublicCenter không rơi về trung tâm #1 khi nhiều tenant.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { resolvePublicCenter } from '../../utils/plans';
import * as parentService from './parent.service';

let centerA = 0;
let parentIds: number[] = [];

const hostReq = (host: string) => ({ get: (h: string) => (h === 'host' ? host : undefined) }) as never;

describe('parent auth hardening', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    centerA = Number(
      (await db.prepare("INSERT INTO centers (name, subdomain) VALUES ('TT A', 'tta')").run()).lastInsertRowid
    );
    await db
      .prepare("INSERT INTO students (code, name, center_id, dob) VALUES ('HV1', 'HV 1', ?, '2015-03-04')")
      .run(centerA);
    parentIds = [];
    for (const phone of ['0900000001', '0900000002', '0900000003']) {
      const r = await db
        .prepare("INSERT INTO parents (phone, password_hash, name, center_id) VALUES (?, 'x', 'PH', ?)")
        .run(phone, centerA);
      parentIds.push(Number(r.lastInsertRowid));
    }
  });
  after(async () => {
    await teardownTestDb();
  });

  it('mã sai và ngày sinh sai trả cùng 1 lỗi; 5 lần sai -> khóa phụ huynh (kể cả DOB đúng)', async () => {
    const p = parentIds[0];
    const e1 = await parentService.linkStudent(p, centerA, 'NOPE', '2015-03-04').catch((e) => e);
    const e2 = await parentService.linkStudent(p, centerA, 'HV1', '2015-01-01').catch((e) => e);
    assert.equal(e1.message, e2.message);
    assert.equal(e1.statusCode, 400);
    for (let i = 0; i < 3; i++)
      await parentService.linkStudent(p, centerA, 'HV1', '2010-01-0' + (i + 1)).catch(() => {});
    const locked = await parentService.linkStudent(p, centerA, 'HV1', '2015-03-04').catch((e) => e);
    assert.equal(locked.statusCode, 429);
  });

  it('khóa theo (trung tâm, mã HV) xuyên nhiều tài khoản phụ huynh', async () => {
    // 2 phụ huynh x 5 lần = 10 lần sai cho HV1 (mỗi phụ huynh chưa chạm ngưỡng riêng ở lần thứ 5)
    for (const p of parentIds.slice(0, 2)) {
      for (let i = 0; i < 5; i++)
        await parentService.linkStudent(p, centerA, 'HV1', `2001-01-0${i + 1}`).catch(() => {});
    }
    const third = await parentService.linkStudent(parentIds[2], centerA, 'HV1', '2015-03-04').catch((e) => e);
    assert.equal(third.statusCode, 429);
  });

  it('DOB đúng -> liên kết được', async () => {
    const s = await parentService.linkStudent(parentIds[0], centerA, 'HV1', '2015-03-04');
    assert.equal(s.code, 'HV1');
  });

  it('resolvePublicCenter: 1 trung tâm -> fallback; nhiều trung tâm + host lạ -> undefined', async () => {
    assert.equal((await resolvePublicCenter(hostReq('localhost:4000')))?.id, centerA);
    const b = Number(
      (await db.prepare("INSERT INTO centers (name, subdomain) VALUES ('TT B', 'ttb')").run()).lastInsertRowid
    );
    assert.equal(await resolvePublicCenter(hostReq('educenter.vn')), undefined);
    assert.equal(await resolvePublicCenter(hostReq('www.educenter.vn')), undefined);
    assert.equal((await resolvePublicCenter(hostReq('ttb.educenter.vn')))?.id, b);
  });
});
