/** Tìm kiếm không dấu (f_unaccent, migration v29): "nguyen dang" khớp "Nguyễn Đăng", wildcard vẫn bị escape. */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { listStudents } from './students.service';

let centerId = 0;
before(async () => {
  await setupTestDb();
  await resetTestDb();
  centerId = Number((await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run()).lastInsertRowid);
  for (const [code, name] of [
    ['HV1', 'Nguyễn Đăng Khoa'],
    ['HV2', 'NGUYỄN THỊ ÁNH'],
    ['HV3', 'Trần 100% Bình'],
  ]) {
    await db
      .prepare('INSERT INTO students (code, name, center_id) VALUES (?, ?, ?)')
      .run(code, name, centerId);
  }
});
after(teardownTestDb);

const names = async (search: string) =>
  ((await listStudents(centerId, { search })).data as { name: string }[]).map((s) => s.name).sort();

describe('tìm kiếm không dấu', () => {
  it('không dấu + không phân biệt hoa thường, cả chữ hoa có dấu', async () => {
    assert.deepEqual(await names('nguyen'), ['NGUYỄN THỊ ÁNH', 'Nguyễn Đăng Khoa']);
    assert.deepEqual(await names('dang khoa'), ['Nguyễn Đăng Khoa']);
    assert.deepEqual(await names('Ánh'), ['NGUYỄN THỊ ÁNH']);
  });
  it('% và _ vẫn là ký tự thường', async () => {
    assert.deepEqual(await names('100%'), ['Trần 100% Bình']);
    assert.deepEqual(await names('%'), ['Trần 100% Bình']);
  });
});
