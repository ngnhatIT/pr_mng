/**
 * Test backup database (db/backup.ts):
 * - Tạo file backup bằng VACUUM INTO (online, không cần dừng app)
 * - File backup là DB hợp lệ, đọc được dữ liệu
 * - Xoay vòng giữ đúng N bản mới nhất
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

declare const require: NodeRequire;

const { createSchema } = require('./schema') as typeof import('./schema');
const { backupDatabase } = require('./backup') as typeof import('./backup');

describe('backupDatabase', () => {
  it('tạo backup hợp lệ và xoay vòng đúng', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO centers (name) VALUES ('TT Backup')").run();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecp-backup-'));

    // backup 3 lần (cách nhau 1.1s để tên file khác nhau)
    const r1 = backupDatabase(db, dir, 2);
    assert.ok(fs.existsSync(r1.path));
    assert.ok(r1.sizeBytes > 0);

    // backup phải là SQLite hợp lệ và có dữ liệu
    const restored = new Database(r1.path, { readonly: true });
    const row = restored.prepare("SELECT COUNT(*) as c FROM centers WHERE name = 'TT Backup'").get() as { c: number };
    assert.equal(row.c, 1);
    restored.close();

    // xoay vòng: keep=2 -> bản cũ nhất bị xóa
    const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    sleep(1100);
    backupDatabase(db, dir, 2);
    sleep(1100);
    const r3 = backupDatabase(db, dir, 2);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'));
    assert.equal(files.length, 2);
    assert.ok(!fs.existsSync(r1.path), 'bản backup cũ nhất phải bị xóa');
    assert.ok(fs.existsSync(r3.path));
    assert.equal(r3.kept, 2);
    assert.equal(r3.deleted.length, 1);

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
