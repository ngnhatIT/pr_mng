/**
 * Integration test P0 red-team: luồng quên mật khẩu qua admin (chưa có email/SMS).
 * POST /auth/forgot-password -> admin GET /auth/reset-requests -> POST /auth/reset-requests/:id/process.
 *
 * Cần PostgreSQL (CI). Dùng node:http thuần, không thêm supertest.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { seedAuthorization, invalidateAllPermissions } from '../authorization/authorization.service';
import { createApp } from '../../app';

let port = 0;
let server: http.Server;

interface HttpResult {
  status: number;
  body: unknown;
}

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ADMIN_PASS = 'Matkhau123';

async function loginAdmin(): Promise<string> {
  const res = await request('POST', '/api/v1/auth/login', {}, { username: 'admin', password: ADMIN_PASS });
  assert.equal(res.status, 200);
  return (res.body as { token: string }).token;
}

describe('quên mật khẩu qua admin', () => {
  before(async () => {
    await setupTestDb();
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as { port: number }).port;
  });
  beforeEach(async () => {
    await resetTestDb();
    invalidateAllPermissions();
    await seedAuthorization();
    await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
    await db
      .prepare("INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (1,'admin',?,'admin','Admin',1)")
      .run(bcrypt.hashSync(ADMIN_PASS, 4));
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await teardownTestDb();
  });

  it('gửi yêu cầu cho tài khoản không tồn tại vẫn trả ok (chống enumeration)', async () => {
    const res = await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'ghost' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const row = (await db
      .prepare("SELECT identifier, kind, status FROM reset_requests WHERE identifier = 'ghost'")
      .get()) as { identifier: string; kind: string; status: string };
    assert.equal(row.kind, 'staff');
    assert.equal(row.status, 'pending');
  });

  it('thiếu kind hoặc identifier -> 400', async () => {
    const res = await request('POST', '/api/v1/auth/forgot-password', {}, { username: 'admin' });
    assert.equal(res.status, 400);
  });

  it('admin xem danh sách và xử lý: sinh mật khẩu tạm, đá session cũ', async () => {
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'admin' });
    const token = await loginAdmin();

    const list = await request('GET', '/api/v1/auth/reset-requests', { authorization: `Bearer ${token}` });
    assert.equal(list.status, 200);
    const rows = (list.body as { data: { id: number; identifier: string; kind: string; status: string }[] }).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');

    const before = (await db.prepare('SELECT token_version FROM users WHERE id = 1').get()) as {
      token_version: number;
    };
    const proc = await request(
      'POST',
      `/api/v1/auth/reset-requests/${rows[0].id}/process`,
      { authorization: `Bearer ${token}` },
      {}
    );
    assert.equal(proc.status, 200);
    const tempPassword = (proc.body as { tempPassword?: string }).tempPassword;
    assert.ok(tempPassword && tempPassword.length >= 8, 'phải trả mật khẩu tạm đủ mạnh');

    const afterRow = (await db.prepare('SELECT password_hash, token_version FROM users WHERE id = 1').get()) as {
      password_hash: string;
      token_version: number;
    };
    assert.ok(bcrypt.compareSync(tempPassword, afterRow.password_hash), 'password_hash phải là mật khẩu tạm mới');
    assert.equal(afterRow.token_version, before.token_version + 1, 'token_version tăng để đá session cũ');
    const reqRow = (await db.prepare('SELECT status FROM reset_requests WHERE id = ?').get(rows[0].id)) as {
      status: string;
    };
    assert.equal(reqRow.status, 'processed');

    // Xử lý lại -> 400
    const again = await request(
      'POST',
      `/api/v1/auth/reset-requests/${rows[0].id}/process`,
      { authorization: `Bearer ${token}` },
      {}
    );
    assert.equal(again.status, 400);
  });

  it('xử lý yêu cầu của tài khoản không tồn tại -> 404, yêu cầu vẫn pending', async () => {
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'parent', phone: '0900000001' });
    const token = await loginAdmin();
    const list = await request('GET', '/api/v1/auth/reset-requests', { authorization: `Bearer ${token}` });
    const id = ((list.body as { data: { id: number }[] }).data[0]).id;
    const proc = await request('POST', `/api/v1/auth/reset-requests/${id}/process`, { authorization: `Bearer ${token}` }, {});
    assert.equal(proc.status, 404);
    const row = (await db.prepare('SELECT status FROM reset_requests WHERE id = ?').get(id)) as { status: string };
    assert.equal(row.status, 'pending');
  });

  it('không đăng nhập -> 401; staff thường không có quyền users.update -> 403', async () => {
    const noAuth = await request('GET', '/api/v1/auth/reset-requests');
    assert.equal(noAuth.status, 401);
    await db
      .prepare("INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (2,'nv',?,'staff','NV',1)")
      .run(bcrypt.hashSync(ADMIN_PASS, 4));
    const login = await request('POST', '/api/v1/auth/login', {}, { username: 'nv', password: ADMIN_PASS });
    assert.equal(login.status, 200);
    const staffToken = (login.body as { token: string }).token;
    const denied = await request('GET', '/api/v1/auth/reset-requests', { authorization: `Bearer ${staffToken}` });
    assert.equal(denied.status, 403);
  });
});
