/**
 * Test gate SEED_DEMO: khi SEED_DEMO unset, seedDatabase() KHÔNG được tạo
 * tài khoản demo (root/123456, teacher1, 0900000001). Khi SEED_DEMO=true thì tạo.
 *
 * Lưu ý: `env.SEED_DEMO` được evaluate lúc load module (config/env.ts), nên mỗi
 * test phải bust require cache của seed + config/env SAU khi đặt biến môi trường.
 * Pool pg-compat giữ nguyên (test DB riêng educenter_test).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from './test-utils';

/** Load lại seedDatabase với env hiện tại (bust cache vì env evaluate lúc import). */
function freshSeedDatabase(): () => Promise<void> {
  for (const rel of ['./seed', '../config/env', './helpers']) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch {
      /* chưa load — bỏ qua */
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./seed').seedDatabase as () => Promise<void>;
}

async function userExists(username: string): Promise<boolean> {
  const r = await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  return !!r;
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  delete process.env.SEED_DEMO;
  await teardownTestDb();
});

describe('seed - SEED_DEMO gate', () => {
  beforeEach(async () => {
    await resetTestDb();
    // 'false' chứ không delete: env.ts nạp lại server/.env khi bust cache, dotenv chỉ
    // điền biến CHƯA có — delete thì SEED_DEMO=true trong .env dev sẽ quay lại.
    process.env.SEED_DEMO = 'false';
  });

  it('SEED_DEMO unset -> seedDatabase() không tạo gì (không có root/123456)', async () => {
    await freshSeedDatabase()();
    assert.equal(await userExists('root'), false, 'không được tạo root');
    assert.equal(await userExists('teacher1'), false, 'không được tạo teacher1');
    assert.equal(await userExists('admin'), false, 'không seed demo khi SEED_DEMO tắt');
  });

  it("SEED_DEMO='true' -> seed đầy đủ gồm root/teacher1/admin", async () => {
    process.env.SEED_DEMO = 'true';
    await freshSeedDatabase()();
    assert.equal(await userExists('root'), true, 'phải tạo root');
    assert.equal(await userExists('teacher1'), true, 'phải tạo teacher1');
    assert.equal(await userExists('admin'), true, 'phải tạo admin demo');
    // DATA-21: hóa đơn demo phải có center_id
    const r = (await db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE center_id IS NULL').get()) as {
      c: number;
    };
    assert.equal(r.c, 0);
  });

  it('SEED_DEMO=true nhưng DB đã có trung tâm thật -> không seed', async () => {
    process.env.SEED_DEMO = 'true';
    await db.prepare("INSERT INTO centers (name, subdomain) VALUES ('TT thật', 'that')").run();
    await freshSeedDatabase()();
    assert.equal(await userExists('admin'), false);
  });
});
