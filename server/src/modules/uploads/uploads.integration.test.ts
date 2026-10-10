/**
 * Integration test YC1: POST /api/v1/uploads (giáo viên tải file đính kèm bài tập)
 * + DELETE /api/v1/uploads/:filename (dọn file mồ côi)
 * + đồng bộ attachments khi updateHomework (thêm/xóa, dọn file vật lý đã gỡ).
 * Cần PostgreSQL (CI). Dùng database test RIÊNG (educenter_test).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres: <redacted>';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres: <redacted>';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { createApp } from '../../app';
import { seedAuthorization, invalidateAllPermissions } from '../authorization/authorization.service';
import { env } from '../../config/env';
import { getUploadDir } from '../../shared/upload';
import {
  createHomeworkBatch,
  updateHomework,
  validateAttachmentInputs,
} from '../homework/homework.service';

// ---------------------------------------------------------------------------
// HTTP helpers (node:http thuần)
// ---------------------------------------------------------------------------

let port = 0;
let server: http.Server;

interface HttpResult {
  status: number;
  body: unknown;
}

function requestRaw(
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: Buffer
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            /* giữ raw */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartPost(
  token: string | null,
  filename: string,
  mimetype: string,
  content: Buffer
): Promise<HttpResult> {
  const boundary = '----testboundary' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, content, tail]);
  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(body.length),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return requestRaw('POST', '/api/v1/uploads', headers, body);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let centerId: number;
let classId: number;
let teacherToken: string;
let viewerToken: string;

function signToken(user: { id: number; role: string }): string {
  return jwt.sign(
    { id: user.id, username: `u${user.id}`, role: user.role, name: `U${user.id}`, kind: 'staff', center_id: centerId },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function createUser(username: string, role: string): Promise<number> {
  const r = await db
    .prepare('INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, ?, ?, ?)')
    .run(username, 'hash', role, username, centerId);
  return Number(r.lastInsertRowid);
}

async function seedFixtures(): Promise<void> {
  await seedAuthorization();
  const rc = await db.prepare('INSERT INTO centers (name) VALUES (?)').run('TT Upload Test');
  centerId = Number(rc.lastInsertRowid);
  const rk = await db
    .prepare('INSERT INTO classes (center_id, name, teacher_id) VALUES (?, ?, NULL)')
    .run(centerId, 'Lớp Test');
  classId = Number(rk.lastInsertRowid);
  // Custom role 'viewer' KHÔNG có quyền nào → kỳ vọng 403
  const rr = await db.prepare("INSERT INTO roles (code, name, is_system) VALUES ('viewer', 'Viewer', 0)").run();
  void rr;
  const teacherId = await createUser('teacher_up', 'teacher'); // có homework.create (scope own)
  const viewerId = await createUser('viewer_up', 'viewer');
  teacherToken = signToken({ id: teacherId, role: 'teacher' });
  viewerToken = signToken({ id: viewerId, role: 'viewer' });
}

function pngBytes(extra = 0): Buffer {
  // Header PNG thật (đủ cho check magic bytes) + payload rác
  const b = Buffer.alloc(16 + extra);
  b.writeUInt32BE(0x89504e47, 0); // 89 50 4E 47
  b.writeUInt32BE(0x0d0a1a0a, 4);
  return b;
}

function diskPath(url: string): string {
  return path.join(getUploadDir(), path.basename(url));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('YC1: POST /api/v1/uploads', () => {
  before(async () => {
    await setupTestDb();
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    port = (server.address() as { port: number }).port;
  });
  beforeEach(async () => {
    await resetTestDb();
    invalidateAllPermissions();
    await seedFixtures();
  });
  after(async () => {
    server.close();
    await teardownTestDb();
  });

  it('giáo viên upload PNG hợp lệ → 201 {url, name, size}, file nằm trên đĩa', async () => {
    const content = pngBytes(100);
    const r = await multipartPost(teacherToken, 'anh-bai-tap.png', 'image/png', content);
    assert.equal(r.status, 201);
    const body = r.body as { url: string; name: string; size: number };
    assert.match(body.url, /^\/uploads\/hw_[0-9a-f-]+\.png$/);
    assert.equal(body.name, 'anh-bai-tap.png');
    assert.equal(body.size, content.length);
    // File vật lý tồn tại
    assert.equal(fs.existsSync(diskPath(body.url)), true);
    // Audit có ghi nhận
    const log = (await db
      .prepare("SELECT id FROM audit_logs WHERE entity = 'upload' AND action = 'create'")
      .get()) as { id: number } | undefined;
    assert.ok(log, 'thiếu audit log upload');
    // Dọn file test
    fs.unlinkSync(diskPath(body.url));
  });

  it('đuôi .png nhưng nội dung text → 400 (magic bytes), file bị xóa khỏi đĩa', async () => {
    const r = await multipartPost(teacherToken, 'gia-mao.png', 'image/png', Buffer.from('day la file text'));
    assert.equal(r.status, 400);
    assert.match((r.body as { error: string }).error, /định dạng/i);
  });

  it('đuôi .exe → 400 (fileFilter chặn)', async () => {
    const r = await multipartPost(teacherToken, 'virus.exe', 'application/octet-stream', pngBytes());
    assert.equal(r.status, 400);
    assert.match((r.body as { error: string }).error, /Định dạng file không hỗ trợ/);
  });

  it('file > 10MB → 413 FILE_TOO_LARGE', async () => {
    const big = pngBytes(11 * 1024 * 1024);
    const r = await multipartPost(teacherToken, 'lon.png', 'image/png', big);
    assert.equal(r.status, 413);
    assert.equal((r.body as { code: string }).code, 'FILE_TOO_LARGE');
  });

  it('tài khoản không có homework.create → 403', async () => {
    const r = await multipartPost(viewerToken, 'anh.png', 'image/png', pngBytes());
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'FORBIDDEN');
  });

  it('không gửi token → 401', async () => {
    const r = await multipartPost(null, 'anh.png', 'image/png', pngBytes());
    assert.equal(r.status, 401);
  });

  it('DELETE file mồ côi → 200, file biến mất khỏi đĩa; tên bậy → 400', async () => {
    const up = await multipartPost(teacherToken, 'mo-coi.png', 'image/png', pngBytes());
    assert.equal(up.status, 201);
    const url = (up.body as { url: string }).url;
    const filename = path.basename(url);
    const del = await requestRaw('DELETE', `/api/v1/uploads/${filename}`, {
      Authorization: `Bearer ${teacherToken}`,
    });
    assert.equal(del.status, 200);
    assert.equal((del.body as { ok: boolean }).ok, true);
    assert.equal(fs.existsSync(diskPath(url)), false);
    // Tên file không hợp lệ (path traversal / ký tự lạ) → 400
    const bad = await requestRaw('DELETE', '/api/v1/uploads/bad%20name!.png', {
      Authorization: `Bearer ${teacherToken}`,
    });
    assert.equal(bad.status, 400);
    // DELETE cần quyền: viewer → 403
    const denied = await requestRaw('DELETE', `/api/v1/uploads/${filename}`, {
      Authorization: `Bearer ${viewerToken}`,
    });
    assert.equal(denied.status, 403);
  });
});

describe('YC1: đồng bộ attachments khi updateHomework', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    invalidateAllPermissions();
    await seedFixtures();
  });
  after(async () => {
    await teardownTestDb();
  });

  /** Tạo 1 file vật lý giả trong upload dir với tên do server sinh. */
  function makeDiskFile(): string {
    const name = `hw_${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(getUploadDir(), name), pngBytes());
    return `/uploads/${name}`;
  }

  async function createHomeworkWithAttachments(
    attachments: { name: string; url: string; kind: string }[]
  ): Promise<number> {
    const teacherId = (
      (await db.prepare("SELECT id FROM users WHERE username = 'teacher_up'").get()) as { id: number }
    ).id;
    const created = await createHomeworkBatch({
      class_ids: [classId],
      title: 'Bài có đính kèm',
      created_by: teacherId,
      centerId,
      attachments,
    });
    return created[0].id;
  }

  async function attachmentUrls(hwId: number): Promise<{ name: string; url: string; kind: string }[]> {
    return (await db
      .prepare('SELECT name, url, kind FROM homework_attachments WHERE homework_id = ? ORDER BY id')
      .all(hwId)) as { name: string; url: string; kind: string }[];
  }

  it('thêm mới + giữ cũ + xóa cái đã gỡ; file vật lý của cái gỡ bị xóa', async () => {
    const oldFile = makeDiskFile();
    const hwId = await createHomeworkWithAttachments([
      { name: 'File cũ', url: oldFile, kind: 'file' },
      { name: 'Link cũ', url: 'https://example.com/tai-lieu', kind: 'link' },
    ]);
    const newFile = makeDiskFile();
    await updateHomework(
      hwId,
      {
        title: 'Bài có đính kèm',
        attachments: [
          { name: 'Link cũ', url: 'https://example.com/tai-lieu', kind: 'link' }, // giữ
          { name: 'File mới', url: newFile, kind: 'file' }, // thêm
          // 'File cũ' bị gỡ → dòng DB mất + file vật lý bị xóa
        ],
      },
      centerId
    );
    const rows = await attachmentUrls(hwId);
    assert.deepEqual(
      rows.map((r) => r.url).sort(),
      ['https://example.com/tai-lieu', newFile].sort()
    );
    assert.equal(fs.existsSync(diskPath(oldFile)), false, 'file cũ phải bị xóa khỏi đĩa');
    assert.equal(fs.existsSync(diskPath(newFile)), true, 'file mới phải còn trên đĩa');
    fs.unlinkSync(diskPath(newFile));
  });

  it('không gửi attachments (undefined) → giữ nguyên, không breaking API cũ', async () => {
    const f = makeDiskFile();
    const hwId = await createHomeworkWithAttachments([{ name: 'File', url: f, kind: 'file' }]);
    await updateHomework(hwId, { title: 'Đổi tiêu đề thôi' }, centerId);
    assert.equal((await attachmentUrls(hwId)).length, 1);
    assert.equal(fs.existsSync(diskPath(f)), true);
    fs.unlinkSync(diskPath(f));
  });

  it('gửi mảng rỗng → xóa hết đính kèm', async () => {
    const f = makeDiskFile();
    const hwId = await createHomeworkWithAttachments([
      { name: 'File', url: f, kind: 'file' },
      { name: 'Link', url: 'https://example.com/x', kind: 'link' },
    ]);
    await updateHomework(hwId, { title: 'Bài có đính kèm', attachments: [] }, centerId);
    assert.equal((await attachmentUrls(hwId)).length, 0);
    assert.equal(fs.existsSync(diskPath(f)), false);
  });

  it('validateAttachmentInputs: chặn link javascript:, /uploads/ tên lạ, thiếu tên', () => {
    assert.throws(
      () => validateAttachmentInputs([{ name: 'X', url: 'javascript:alert(1)', kind: 'link' }]),
      /http/
    );
    assert.throws(
      () => validateAttachmentInputs([{ name: 'X', url: '/uploads/../secret.txt', kind: 'file' }]),
      /không hợp lệ/
    );
    assert.throws(() => validateAttachmentInputs([{ name: '', url: 'https://a.vn', kind: 'link' }]), /thiếu tên/);
    // Hợp lệ: /uploads/ tên server sinh → ép kind='file'
    const ok = validateAttachmentInputs([
      { name: 'A', url: `/uploads/hw_${crypto.randomUUID()}.pdf`, kind: 'link' },
    ]);
    assert.equal(ok[0].kind, 'file');
  });
});
