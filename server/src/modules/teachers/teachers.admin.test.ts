/**
 * CI-3: DELETE /teachers/:id (khóa TK, tăng token_version, thu hồi refresh token, JWT cũ hết hiệu lực)
 * và POST /teachers/:id/account (mật khẩu yếu, trùng username, khác trung tâm).
 * Cần PostgreSQL (database test riêng).
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { createApp } from '../../app';
import { seedAuthorization, invalidateAllPermissions } from '../authorization/authorization.service';
import { env } from '../../config/env';

let server: http.Server;
let port = 0;

function call(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const buf = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (buf)
    Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.end(buf);
  });
}

const sign = (id: number, role: string, center: number, teacherId: number | null = null) =>
  jwt.sign(
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

const insertId = async (sql: string, ...args: unknown[]) =>
  Number((await db.prepare(sql).run(...args)).lastInsertRowid);

let centerId: number;
let teacherId: number;
let adminToken: string;
let otherAdminToken: string;

before(async () => {
  await setupTestDb();
  server = createApp().listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  port = (server.address() as { port: number }).port;
});
beforeEach(async () => {
  await resetTestDb();
  invalidateAllPermissions();
  await seedAuthorization();
  centerId = await insertId('INSERT INTO centers (name) VALUES (?)', 'TT A');
  const other = await insertId('INSERT INTO centers (name) VALUES (?)', 'TT B');
  teacherId = await insertId('INSERT INTO teachers (name, center_id) VALUES (?, ?)', 'GV Xóa', centerId);
  const mk = (u: string, c: number) =>
    insertId(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, 'h', 'admin', ?, ?)",
      u,
      u,
      c
    );
  adminToken = sign(await mk('admin_a', centerId), 'admin', centerId);
  otherAdminToken = sign(await mk('admin_b', other), 'admin', other);
});
after(async () => {
  server.close();
  await teardownTestDb();
});

describe('DELETE /api/v1/teachers/:id', () => {
  it('khác trung tâm → 404, giáo viên còn nguyên', async () => {
    const r = await call('DELETE', `/api/v1/teachers/${teacherId}`, otherAdminToken);
    assert.equal(r.status, 404);
    assert.ok(await db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(teacherId));
  });

  it('xóa → khóa TK giáo viên, thu hồi refresh token, JWT cũ bị từ chối, ghi audit', async () => {
    const uid = await insertId(
      "INSERT INTO users (username, password_hash, role, name, center_id, teacher_id) VALUES ('gv1', 'h', 'teacher', 'GV', ?, ?)",
      centerId,
      teacherId
    );
    await db
      .prepare(
        "INSERT INTO refresh_tokens (token_hash, user_id, kind, expires_at) VALUES ('hash-gv1', ?, 'staff', NOW() + INTERVAL '1 day')"
      )
      .run(uid);
    const teacherToken = sign(uid, 'teacher', centerId, teacherId);
    assert.equal((await call('GET', '/api/v1/auth/me', teacherToken)).status, 200);

    const r = await call('DELETE', `/api/v1/teachers/${teacherId}`, adminToken);
    assert.equal(r.status, 200);
    assert.equal(await db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(teacherId), undefined);
    const u = (await db.prepare('SELECT is_active, token_version FROM users WHERE id = ?').get(uid)) as {
      is_active: boolean;
      token_version: number;
    };
    assert.equal(u.is_active, false);
    assert.equal(u.token_version, 2);
    const rt = (await db.prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id = ?').get(uid)) as {
      revoked_at: unknown;
    };
    assert.notEqual(rt.revoked_at, null);
    assert.notEqual((await call('GET', '/api/v1/auth/me', teacherToken)).status, 200);
    assert.ok(
      await db
        .prepare("SELECT 1 FROM audit_logs WHERE entity = 'teachers' AND action = 'delete' AND entity_id = ?")
        .get(teacherId)
    );
  });

  it('giáo viên đã có cấu hình lương → 400 HAS_PAYROLL', async () => {
    await db
      .prepare('INSERT INTO salary_rules (teacher_id, per_session_amount) VALUES (?, 100000)')
      .run(teacherId);
    const r = await call('DELETE', `/api/v1/teachers/${teacherId}`, adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'HAS_PAYROLL');
  });
});

describe('POST /api/v1/teachers/:id/account', () => {
  const url = () => `/api/v1/teachers/${teacherId}/account`;

  it('mật khẩu yếu → 400 WEAK_PASSWORD, không tạo user', async () => {
    const r = await call('POST', url(), adminToken, { username: 'gv_new', password: '123' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'WEAK_PASSWORD');
    assert.equal(await db.prepare("SELECT 1 FROM users WHERE username = 'gv_new'").get(), undefined);
  });

  it('trùng username → 400 ALREADY_EXISTS', async () => {
    const r = await call('POST', url(), adminToken, { username: 'admin_a', password: 'Str0ng!Passw0rd' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'ALREADY_EXISTS');
  });

  it('khác trung tâm → 404', async () => {
    const r = await call('POST', url(), otherAdminToken, { username: 'gv_x', password: 'Str0ng!Passw0rd' });
    assert.equal(r.status, 404);
  });

  it('hợp lệ → 201, user role teacher gắn teacher_id + center; lần 2 → 400 (đã có tài khoản)', async () => {
    const r = await call('POST', url(), adminToken, { username: ' gv_ok ', password: 'Str0ng!Passw0rd' });
    assert.equal(r.status, 201);
    assert.equal(r.body.username, 'gv_ok');
    const u = (await db
      .prepare('SELECT role, teacher_id, center_id, must_change_password FROM users WHERE id = ?')
      .get(r.body.user_id)) as {
      role: string;
      teacher_id: number;
      center_id: number;
      must_change_password: boolean;
    };
    // N-5: admin đặt mật khẩu hộ -> giáo viên phải đổi ở lần đăng nhập đầu
    assert.deepEqual(u, {
      role: 'teacher',
      teacher_id: teacherId,
      center_id: centerId,
      must_change_password: true,
    });
    const again = await call('POST', url(), adminToken, { username: 'gv_ok2', password: 'Str0ng!Passw0rd' });
    assert.equal(again.status, 400);
  });
});
