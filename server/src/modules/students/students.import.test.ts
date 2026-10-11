/**
 * Nhập học viên từ file (DB thật): dry run không ghi, lỗi theo dòng có mã để client dịch,
 * nhập thật chỉ thêm dòng hợp lệ, mã trống tự sinh nối tiếp, mã trùng trong file/DB bị chặn.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { importStudents } from './students.import';

let centerId = 0;
const codes = async () =>
  (
    (await db.prepare('SELECT code FROM students WHERE center_id = ? ORDER BY code').all(centerId)) as {
      code: string;
    }[]
  ).map((r) => r.code);

before(setupTestDb);
after(teardownTestDb);
beforeEach(async () => {
  await resetTestDb();
  centerId = Number((await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run()).lastInsertRowid);
  await db.prepare("INSERT INTO students (code, name, center_id) VALUES ('HV0007', 'Cũ', ?)").run(centerId);
});

describe('importStudents', () => {
  const rows = [
    { name: 'An', phone: '0901', dob: '2010-05-01' },
    { name: '', email: 'x' },
    { code: 'HV0007', name: 'Trùng DB' },
    { code: 'A1', name: 'B' },
    { code: 'A1', name: 'C', dob: '2010-02-30', status: 'gone' },
    { name: 'D', email: 'd@ex.com', status: 'paused' },
  ];

  it('dry run: lỗi theo dòng (dòng 2 = dữ liệu đầu tiên), không ghi gì', async () => {
    const r = await importStudents(centerId, rows, { dryRun: true });
    assert.deepEqual([r.total, r.valid, r.created], [6, 3, 0]);
    assert.deepEqual(
      r.errors.map((e) => `${e.row}:${e.field}:${e.code}`),
      [
        '3:name:required',
        '3:email:invalid_email',
        '4:code:code_exists',
        '6:dob:invalid_date',
        '6:status:invalid_status',
        '6:code:duplicate_in_file',
      ]
    );
    assert.deepEqual(await codes(), ['HV0007']);
  });

  it('nhập thật: chỉ thêm dòng hợp lệ, mã trống tự sinh nối tiếp HV0007', async () => {
    const r = await importStudents(centerId, rows, { dryRun: false });
    assert.equal(r.created, 3);
    assert.deepEqual(await codes(), ['A1', 'HV0007', 'HV0008', 'HV0009']);
    const d = (await db.prepare("SELECT status FROM students WHERE name = 'D'").get()) as { status: string };
    assert.equal(d.status, 'paused');
  });

  it('file rỗng / quá lớn bị từ chối', async () => {
    await assert.rejects(importStudents(centerId, [], { dryRun: true }), { code: 'IMPORT_EMPTY' });
    await assert.rejects(importStudents(centerId, Array(2001).fill({ name: 'x' }), { dryRun: true }), {
      code: 'IMPORT_TOO_LARGE',
    });
  });
});
