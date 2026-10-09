/**
 * Test backup database PostgreSQL (db/backup.ts):
 * - Tạo file backup bằng pg_dump (custom format, online)
 * - File backup tồn tại và có dung lượng > 0
 * - Xoay vòng giữ đúng N bản mới nhất
 */
// LƯU Ý: Chạy test với DATABASE_URL trỏ tới test DB:
//   DATABASE_URL=postgres://educenter:educenter123@localhost:5432/educenter_test node --test ...
// (pg-compat đọc DATABASE_URL lúc load module — không set trong file vì ES module hoist imports)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from './pg-compat';
import { backupDatabase } from './backup';
import { setupTestDb, teardownTestDb } from './test-utils';

describe('backupDatabase (PostgreSQL pg_dump)', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('tạo backup hợp lệ và xoay vòng đúng', async () => {
    await db.prepare("INSERT INTO centers (name) VALUES ('TT Backup')").run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecp-backup-'));

    // backup 3 lần (cách nhau 1.1s để tên file khác nhau)
    const r1 = await backupDatabase(dir, 2);
    assert.ok(fs.existsSync(r1.path), 'file backup phải tồn tại');
    assert.ok(r1.sizeBytes > 0, 'backup phải có dung lượng');
    assert.ok(r1.path.endsWith('.dump'), 'định dạng pg_dump custom');

    // xoay vòng: keep=2 -> bản cũ nhất bị xóa
    const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    sleep(1100);
    await backupDatabase(dir, 2);
    sleep(1100);
    const r3 = await backupDatabase(dir, 2);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.dump'));
    assert.equal(files.length, 2);
    assert.ok(!fs.existsSync(r1.path), 'bản backup cũ nhất phải bị xóa');
    assert.ok(fs.existsSync(r3.path));
    assert.equal(r3.kept, 2);
    assert.equal(r3.deleted.length, 1);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restore từ backup khôi phục được dữ liệu', async () => {
    const { execFileSync } = await import('child_process');
    // Tạo dữ liệu mẫu
    await db.prepare("INSERT INTO centers (name) VALUES ('TT Restore Test')").run();
    const before = (await db.prepare('SELECT COUNT(*) as c FROM centers').get()) as { c: string };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecp-restore-'));
    const { path: dumpPath } = await backupDatabase(dir, 7);

    // Giả lập thảm họa: xóa toàn bộ bảng
    await db.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
        END LOOP;
      END $$;
    `);

    // Restore từ backup
    const dbUrl = process.env.DATABASE_URL || '';
    execFileSync('pg_restore', ['--clean', '--if-exists', '-d', dbUrl, dumpPath], {
      stdio: 'pipe',
      env: { ...process.env, PGCONNECT_TIMEOUT: '10' },
    });

    // Verify dữ liệu quay lại
    const after = (await db.prepare('SELECT COUNT(*) as c FROM centers').get()) as { c: string };
    assert.equal(Number(after.c), Number(before.c), 'restore phải khôi phục đúng số centers');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
