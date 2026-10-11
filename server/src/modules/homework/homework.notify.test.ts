/**
 * C-5: superadmin đăng bài không kèm ?center_id → event mang centerId null; log nhắc Zalo vẫn phải
 * gắn trung tâm của chính bài tập (trước đây center_id NULL → trung tâm không thấy lịch sử).
 * Cần PostgreSQL (database test riêng).
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;

import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { notifyHomework } from './homework.notify';

before(async () => {
  await setupTestDb();
  await resetTestDb();
});
after(teardownTestDb);

it('notifyHomework(null, id) ghi reminders với center_id của bài tập', async () => {
  const center = Number(
    (await db.prepare("INSERT INTO centers (name) VALUES ('TT Notify')").run()).lastInsertRowid
  );
  const cls = Number(
    (await db.prepare("INSERT INTO classes (center_id, name) VALUES (?, 'Lớp N')").run(center))
      .lastInsertRowid
  );
  const hw = Number(
    (
      await db
        .prepare("INSERT INTO homework (center_id, class_id, title) VALUES (?, ?, 'Bài N')")
        .run(center, cls)
    ).lastInsertRowid
  );
  await notifyHomework(null, hw);
  const rows = (await db.prepare("SELECT center_id FROM reminders WHERE kind = 'homework'").all()) as {
    center_id: number | null;
  }[];
  assert.deepEqual(rows, [{ center_id: center }]);
});
