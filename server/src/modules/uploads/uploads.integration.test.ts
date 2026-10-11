/**
 * Integration test YC1: POST /api/v1/uploads (giáo viên tải file đính kèm bài tập)
 * + DELETE /api/v1/uploads/:filename (HW-6: chỉ file của mình/trung tâm, chưa tham chiếu)
 * + GET /uploads/:filename (HW-2/HW-7: đính kèm tải được, xét theo permission scope)
 * + đồng bộ attachments khi updateHomework, copy file theo lớp (HW-3), sweeper (HW-16),
 *   PUT giữ trạng thái nháp (HW-1).
 * Cần PostgreSQL (CI). Dùng database test RIÊNG (educenter_test). File ghi vào thư mục
 * tạm qua UPLOAD_DIR (OPS-4) — không chạm thư mục uploads thật.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
// OPS-4: thư mục upload tạm riêng cho test (config/env đọc lúc load module)
/* eslint-disable @typescript-eslint/no-require-imports -- phải chạy trước mọi import (CJS giữ thứ tự) */
process.env.UPLOAD_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  `educenter-test-uploads-${process.pid}`
);
/* eslint-enable @typescript-eslint/no-require-imports */

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
import { getUploadDir, recordUpload, sweepOrphanUploads } from '../../shared/upload';
import {
  createHomeworkBatch,
  updateHomework,
  deleteHomework,
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
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
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
    });
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

const authGet = (token: string, p: string) => requestRaw('GET', p, { Authorization: `Bearer ${token}` });
const authDelete = (token: string, p: string) =>
  requestRaw('DELETE', p, { Authorization: `Bearer ${token}` });

function jsonPut(token: string, urlPath: string, body: unknown): Promise<HttpResult> {
  const buf = Buffer.from(JSON.stringify(body));
  return requestRaw(
    'PUT',
    urlPath,
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': String(buf.length),
    },
    buf
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let centerId: number;
let otherCenterId: number;
let classId: number;
let teacherUserId: number;
let teacherToken: string; // GV dạy lớp Test (homework.* scope own)
let teacher2Token: string; // GV cùng trung tâm, KHÔNG dạy lớp Test
let staffToken: string; // nhân viên cùng trung tâm (scope center)
let otherStaffToken: string; // nhân viên trung tâm khác
let viewerToken: string; // không có homework.create / homework.view
let parentToken: string; // con học lớp Test
let strangerParentToken: string; // con không học lớp Test

function signToken(id: number, role: string, center: number, teacherId: number | null = null): string {
  return jwt.sign(
    {
      id,
      username: `u${id}`,
      role,
      name: `U${id}`,
      kind: 'staff',
      center_id: center,
      teacher_id: teacherId,
      tv: 1,
    },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function signParent(parentId: number, center: number): string {
  return jwt.sign(
    {
      id: parentId,
      username: `p${parentId}`,
      role: 'parent',
      name: 'PH',
      kind: 'parent',
      parent_id: parentId,
      center_id: center,
      tv: 1,
    },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function insertId(sql: string, ...args: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).run(...args)).lastInsertRowid);
}

async function createUser(
  username: string,
  role: string,
  center: number,
  teacherId: number | null = null
): Promise<number> {
  return insertId(
    'INSERT INTO users (username, password_hash, role, name, center_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)',
    username,
    'hash',
    role,
    username,
    center,
    teacherId
  );
}

async function seedFixtures(): Promise<void> {
  await seedAuthorization();
  centerId = await insertId('INSERT INTO centers (name) VALUES (?)', 'TT Upload Test');
  otherCenterId = await insertId('INSERT INTO centers (name) VALUES (?)', 'TT Khác');
  const t1 = await insertId('INSERT INTO teachers (name, center_id) VALUES (?, ?)', 'GV 1', centerId);
  const t2 = await insertId('INSERT INTO teachers (name, center_id) VALUES (?, ?)', 'GV 2', centerId);
  classId = await insertId(
    'INSERT INTO classes (center_id, name, teacher_id) VALUES (?, ?, ?)',
    centerId,
    'Lớp Test',
    t1
  );
  teacherUserId = await createUser('teacher_up', 'teacher', centerId, t1);
  teacherToken = signToken(teacherUserId, 'teacher', centerId, t1);
  teacher2Token = signToken(
    await createUser('teacher_up2', 'teacher', centerId, t2),
    'teacher',
    centerId,
    t2
  );
  staffToken = signToken(await createUser('staff_up', 'staff', centerId), 'staff', centerId);
  otherStaffToken = signToken(
    await createUser('staff_other', 'staff', otherCenterId),
    'staff',
    otherCenterId
  );
  // Mọi role hệ thống đều có homework.* → dùng role 'admin' (không test nào khác dùng) và gỡ
  // quyền homework.create/view của admin trong DB test để có 1 tài khoản KHÔNG có quyền.
  await db
    .prepare(
      `DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'admin' AND center_id IS NULL)
       AND permission_id IN (SELECT id FROM permissions WHERE code IN ('homework.create', 'homework.view', 'homework.grade'))`
    )
    .run();
  viewerToken = signToken(await createUser('viewer_up', 'admin', centerId), 'admin', centerId);
  invalidateAllPermissions();
  // Phụ huynh có con học lớp Test, và phụ huynh có con KHÔNG học lớp này
  const st = await insertId(
    "INSERT INTO students (code, name, center_id) VALUES ('UP1', 'HV 1', ?)",
    centerId
  );
  const st2 = await insertId(
    "INSERT INTO students (code, name, center_id) VALUES ('UP2', 'HV 2', ?)",
    centerId
  );
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(st, classId);
  const p1 = await insertId(
    "INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, '0900000001', 'x', 'PH 1')",
    centerId
  );
  const p2 = await insertId(
    "INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, '0900000002', 'x', 'PH 2')",
    centerId
  );
  await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(p1, st);
  await db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(p2, st2);
  parentToken = signParent(p1, centerId);
  strangerParentToken = signParent(p2, centerId);
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

/** Tạo 1 file vật lý giả trong upload dir (tên do server sinh) + ghi sổ uploads như POST /uploads. */
async function makeUpload(center: number = centerId): Promise<string> {
  const name = `hw_${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(getUploadDir(), name), pngBytes());
  await recordUpload(`/uploads/${name}`, center, teacherUserId);
  return `/uploads/${name}`;
}

async function uploadViaApi(token: string = teacherToken): Promise<string> {
  const r = await multipartPost(token, 'tai-lieu.png', 'image/png', pngBytes());
  assert.equal(r.status, 201);
  return (r.body as { url: string }).url;
}

async function createHw(
  attachments: { name: string; url: string; kind: string }[],
  status: 'draft' | 'published' = 'published',
  classIds: number[] = [classId]
): Promise<number[]> {
  const created = await createHomeworkBatch({
    class_ids: classIds,
    title: 'Bài có đính kèm',
    created_by: teacherUserId,
    centerId,
    status,
    attachments,
  });
  return created.map((h) => h.id);
}

async function attachmentUrls(hwId: number): Promise<string[]> {
  return (
    (await db
      .prepare('SELECT url FROM homework_attachments WHERE homework_id = ? ORDER BY id')
      .all(hwId)) as {
      url: string;
    }[]
  ).map((r) => r.url);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
  fs.rmSync(getUploadDir(), { recursive: true, force: true });
});

describe('YC1: POST /api/v1/uploads', () => {
  it('giáo viên upload PNG hợp lệ → 201 {url, name, size}, file trên đĩa, ghi sổ uploads; tên tiếng Việt giữ nguyên (HW-11)', async () => {
    const content = pngBytes(100);
    const r = await multipartPost(teacherToken, 'Bài tập tuần 3.png', 'image/png', content);
    assert.equal(r.status, 201);
    const body = r.body as { url: string; name: string; size: number };
    assert.match(body.url, /^\/uploads\/hw_[0-9a-f-]+\.png$/);
    assert.equal(body.name, 'Bài tập tuần 3.png');
    assert.equal(body.size, content.length);
    assert.equal(fs.existsSync(diskPath(body.url)), true);
    const row = (await db
      .prepare('SELECT center_id, uploaded_by FROM uploads WHERE filename = ?')
      .get(path.basename(body.url))) as { center_id: number; uploaded_by: number } | undefined;
    assert.deepEqual(row, { center_id: centerId, uploaded_by: teacherUserId });
    const log = await db
      .prepare("SELECT id FROM audit_logs WHERE entity = 'upload' AND action = 'create'")
      .get();
    assert.ok(log, 'thiếu audit log upload');
  });

  it('đuôi .png nhưng nội dung text → 400 (magic bytes)', async () => {
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
    const r = await multipartPost(teacherToken, 'lon.png', 'image/png', pngBytes(11 * 1024 * 1024));
    assert.equal(r.status, 413);
    assert.equal((r.body as { code: string }).code, 'FILE_TOO_LARGE');
  });

  it('tài khoản không có homework.create → 403; không token → 401', async () => {
    const r = await multipartPost(viewerToken, 'anh.png', 'image/png', pngBytes());
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'FORBIDDEN');
    assert.equal((await multipartPost(null, 'anh.png', 'image/png', pngBytes())).status, 401);
  });
});

describe('HW-6: DELETE /api/v1/uploads/:filename', () => {
  it('người tải xóa file mồ côi → 200, file + dòng sổ biến mất; tên bậy → 400; không quyền → 403', async () => {
    const url = await uploadViaApi();
    const filename = path.basename(url);
    assert.equal((await authDelete(viewerToken, `/api/v1/uploads/${filename}`)).status, 403);
    const del = await authDelete(teacherToken, `/api/v1/uploads/${filename}`);
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(diskPath(url)), false);
    assert.equal(await db.prepare('SELECT 1 FROM uploads WHERE filename = ?').get(filename), undefined);
    assert.equal((await authDelete(teacherToken, '/api/v1/uploads/bad%20name!.png')).status, 400);
  });

  it('GV khác (scope own) không xóa được file người khác; staff cùng trung tâm xóa được; trung tâm khác → 404', async () => {
    const url = await uploadViaApi();
    const filename = path.basename(url);
    assert.equal((await authDelete(teacher2Token, `/api/v1/uploads/${filename}`)).status, 404);
    assert.equal((await authDelete(otherStaffToken, `/api/v1/uploads/${filename}`)).status, 404);
    assert.equal(fs.existsSync(diskPath(url)), true);
    assert.equal((await authDelete(staffToken, `/api/v1/uploads/${filename}`)).status, 200);
    assert.equal(fs.existsSync(diskPath(url)), false);
  });

  it('file đã gắn vào bài tập → 409, file còn nguyên', async () => {
    const url = await uploadViaApi();
    await createHw([{ name: 'Đề', url, kind: 'file' }]);
    const r = await authDelete(teacherToken, `/api/v1/uploads/${path.basename(url)}`);
    assert.equal(r.status, 409);
    assert.equal(fs.existsSync(diskPath(url)), true);
  });

  it('file không có trong sổ uploads (vd bài nộp của học viên) → 404, không xóa', async () => {
    const name = `hw_${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(getUploadDir(), name), pngBytes());
    assert.equal((await authDelete(staffToken, `/api/v1/uploads/${name}`)).status, 404);
    assert.equal(fs.existsSync(path.join(getUploadDir(), name)), true);
  });
});

describe('HW-6: chỉ gắn được file /uploads của trung tâm mình', () => {
  it('file không có trong sổ / của trung tâm khác → 400; file của mình → OK', async () => {
    const stray = `/uploads/hw_${crypto.randomUUID()}.png`;
    await assert.rejects(
      createHw([{ name: 'Lạ', url: stray, kind: 'file' }]),
      /không hợp lệ hoặc không thuộc/
    );
    const foreign = await makeUpload(otherCenterId);
    await assert.rejects(createHw([{ name: 'Ngoại', url: foreign, kind: 'file' }]), /không thuộc trung tâm/);
    const [hwId] = await createHw([]);
    await assert.rejects(
      updateHomework(
        hwId,
        { title: 'X', attachments: [{ name: 'Ngoại', url: foreign, kind: 'file' }] },
        centerId
      ),
      /không thuộc trung tâm/
    );
    const mine = await makeUpload();
    const [ok] = await createHw([{ name: 'Của tôi', url: mine, kind: 'file' }]);
    assert.deepEqual(await attachmentUrls(ok), [mine]);
  });
});

describe('HW-2/HW-7: GET /uploads/:filename cho đính kèm bài tập', () => {
  it('GV dạy lớp, staff cùng trung tâm, phụ huynh có con học lớp → 200; GV khác lớp / trung tâm khác / PH lạ → chặn', async () => {
    const url = await uploadViaApi();
    await createHw([{ name: 'Đề', url, kind: 'file' }]);
    assert.equal((await authGet(teacherToken, url)).status, 200);
    assert.equal((await authGet(staffToken, url)).status, 200);
    assert.equal((await authGet(parentToken, url)).status, 200);
    assert.equal((await authGet(teacher2Token, url)).status, 403);
    assert.equal((await authGet(otherStaffToken, url)).status, 403);
    assert.equal((await authGet(viewerToken, url)).status, 403);
    assert.equal((await authGet(strangerParentToken, url)).status, 404);
  });

  it('bài còn nháp → phụ huynh không xem được đính kèm; file chưa gắn chỉ người tải/staff xem', async () => {
    const url = await uploadViaApi();
    assert.equal((await authGet(teacherToken, url)).status, 200); // người tải xem trước khi gắn
    assert.equal((await authGet(teacher2Token, url)).status, 403);
    await createHw([{ name: 'Đề', url, kind: 'file' }], 'draft');
    assert.equal((await authGet(parentToken, url)).status, 404);
  });
});

describe('YC1: đồng bộ attachments khi updateHomework', () => {
  it('thêm mới + giữ cũ + xóa cái đã gỡ; file vật lý của cái gỡ bị xóa', async () => {
    const oldFile = await makeUpload();
    const [hwId] = await createHw([
      { name: 'File cũ', url: oldFile, kind: 'file' },
      { name: 'Link cũ', url: 'https://example.com/tai-lieu', kind: 'link' },
    ]);
    const newFile = await makeUpload();
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
    assert.deepEqual((await attachmentUrls(hwId)).sort(), ['https://example.com/tai-lieu', newFile].sort());
    assert.equal(fs.existsSync(diskPath(oldFile)), false, 'file cũ phải bị xóa khỏi đĩa');
    assert.equal(fs.existsSync(diskPath(newFile)), true, 'file mới phải còn trên đĩa');
  });

  it('không gửi attachments (undefined) → giữ nguyên', async () => {
    const f = await makeUpload();
    const [hwId] = await createHw([{ name: 'File', url: f, kind: 'file' }]);
    await updateHomework(hwId, { title: 'Đổi tiêu đề thôi' }, centerId);
    assert.equal((await attachmentUrls(hwId)).length, 1);
    assert.equal(fs.existsSync(diskPath(f)), true);
  });

  it('gửi mảng rỗng → xóa hết đính kèm', async () => {
    const f = await makeUpload();
    const [hwId] = await createHw([
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
    assert.throws(
      () => validateAttachmentInputs([{ name: '', url: 'https://a.vn', kind: 'link' }]),
      /thiếu tên/
    );
    const ok = validateAttachmentInputs([
      { name: 'A', url: `/uploads/hw_${crypto.randomUUID()}.pdf`, kind: 'link' },
    ]);
    assert.equal(ok[0].kind, 'file');
  });
});

describe('HW-3: giao nhiều lớp không dùng chung 1 file vật lý', () => {
  it('mỗi lớp có bản copy riêng; xóa bài lớp A không làm lớp B mất file', async () => {
    const classB = await insertId('INSERT INTO classes (center_id, name) VALUES (?, ?)', centerId, 'Lớp B');
    const f = await makeUpload();
    const [a, b] = await createHw([{ name: 'Đề', url: f, kind: 'file' }], 'published', [classId, classB]);
    const [ua] = await attachmentUrls(a);
    const [ub] = await attachmentUrls(b);
    assert.notEqual(ua, ub);
    await deleteHomework(a, centerId);
    assert.equal(fs.existsSync(diskPath(ua)), false);
    assert.equal(fs.existsSync(diskPath(ub)), true);
  });

  it('dữ liệu cũ 2 bài trỏ chung 1 file: xóa 1 bài → file còn cho bài kia', async () => {
    const f = await makeUpload();
    const [a] = await createHw([{ name: 'Đề', url: f, kind: 'file' }]);
    const [b] = await createHw([]);
    await db
      .prepare("INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, 'Đề', ?, 'file')")
      .run(b, f);
    await deleteHomework(a, centerId);
    assert.equal(fs.existsSync(diskPath(f)), true);
    await deleteHomework(b, centerId);
    assert.equal(fs.existsSync(diskPath(f)), false);
  });
});

describe('HW-16: sweeper dọn file tải lên > 24h chưa gắn bài', () => {
  it('file mồ côi cũ bị dọn; file mới hoặc đã gắn được giữ', async () => {
    const orphan = await makeUpload();
    const fresh = await makeUpload();
    const attached = await makeUpload();
    await createHw([{ name: 'Đề', url: attached, kind: 'file' }]);
    await db
      .prepare("UPDATE uploads SET created_at = '2000-01-01 00:00:00' WHERE filename IN (?, ?)")
      .run(path.basename(orphan), path.basename(attached));
    assert.equal(await sweepOrphanUploads(24), 1);
    assert.equal(fs.existsSync(diskPath(orphan)), false);
    assert.equal(fs.existsSync(diskPath(fresh)), true);
    assert.equal(fs.existsSync(diskPath(attached)), true);
  });
});

describe('HW-1: PUT /api/v1/homework/:id không gửi status → giữ nguyên', () => {
  it('bài nháp sửa tiêu đề vẫn là nháp; max_score/nội dung không gửi thì giữ', async () => {
    const [id] = await createHomeworkBatch({
      class_ids: [classId],
      title: 'Nháp',
      content: 'Nội dung',
      max_score: 10,
      created_by: teacherUserId,
      centerId,
      status: 'draft',
    });
    const r = await jsonPut(staffToken, `/api/v1/homework/${id.id}`, { title: 'Nháp đã sửa' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = (await db
      .prepare('SELECT title, status, content, max_score FROM homework WHERE id = ?')
      .get(id.id)) as {
      title: string;
      status: string;
      content: string;
      max_score: number;
    };
    assert.equal(row.title, 'Nháp đã sửa');
    assert.equal(row.status, 'draft');
    assert.equal(row.content, 'Nội dung');
    assert.equal(Number(row.max_score), 10);
  });
});
