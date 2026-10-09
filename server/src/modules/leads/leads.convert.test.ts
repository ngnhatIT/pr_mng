/**
 * Regression test: convertLeadToStudent atomic (chống convert đồng thời như trials).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat.js';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils.js';
import { convertLeadToStudent } from './leads.service.js';

describe('Leads convert atomicity', () => {
  let centerId: number;

  before(async () => {
    await setupTestDb();
    await resetTestDb();
    centerId = Number(
      (await db.prepare('INSERT INTO centers (name) VALUES (?)').run('Lead Center')).lastInsertRowid
    );
  });

  after(async () => {
    await teardownTestDb();
  });

  it('2 convert đồng thời: chỉ 1 thành công, 1 student', async () => {
    const leadId = Number(
      (
        await db
          .prepare(
            "INSERT INTO leads (name, phone, center_id, status) VALUES ('Lead A', '0901111222', ?, 'new')"
          )
          .run(centerId)
      ).lastInsertRowid
    );
    const results = await Promise.allSettled([
      convertLeadToStudent({ leadId, centerId }),
      convertLeadToStudent({ leadId, centerId }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, 'chỉ 1 convert thành công');
    assert.equal(failed.length, 1, '1 convert bị từ chối');
    const count = (await db
      .prepare('SELECT COUNT(*) as c FROM students WHERE phone = ?')
      .get('0901111222')) as { c: number };
    assert.equal(count.c, 1, 'không tạo trùng học viên');
  });

  it('convert trùng lần 2 trả 409', async () => {
    const leadId = Number(
      (
        await db
          .prepare(
            "INSERT INTO leads (name, phone, center_id, status) VALUES ('Lead B', '0903333444', ?, 'new')"
          )
          .run(centerId)
      ).lastInsertRowid
    );
    await convertLeadToStudent({ leadId, centerId });
    await assert.rejects(() => convertLeadToStudent({ leadId, centerId }), /đã được chuyển/);
  });
});
