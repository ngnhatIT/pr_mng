/**
 * Integration test D4: refresh token qua HttpOnly cookie (end-to-end qua HTTP).
 * login -> Set-Cookie HttpOnly (body KHÔNG có refresh_token)
 *   -> refresh bằng Cookie -> cặp mới + cookie xoay
 *   -> Origin lạ bị 403 (anti-CSRF)
 *   -> logout -> cookie bị xóa, dùng lại cookie cũ -> 401
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
import { createApp } from '../../app';

let port = 0;
let server: http.Server;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
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
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Lấy giá trị cookie refresh_token từ header Set-Cookie. */
function refreshCookieValue(setCookie: string | string[] | undefined): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = list.find((c) => c.startsWith('refresh_token='));
  return found?.split(';')[0].slice('refresh_token='.length);
}

describe('D4: refresh token qua HttpOnly cookie', () => {
  before(async () => {
    await setupTestDb();
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as { port: number }).port;
  });
  beforeEach(async () => {
    await resetTestDb();
    await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
    await db
      .prepare(
        "INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (1,'admin',?,'admin','Admin',1)"
      )
      .run(bcrypt.hashSync('Matkhau123', 4));
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await teardownTestDb();
  });

  it('login -> access trong body, refresh chỉ trong HttpOnly cookie', async () => {
    const res = await request(
      'POST',
      '/api/v1/auth/login',
      {},
      { username: 'admin', password: 'Matkhau123' }
    );
    assert.equal(res.status, 200);
    const body = res.body as { token?: string; refresh_token?: string };
    assert.ok(body.token, 'body phải có access token');
    assert.equal(body.refresh_token, undefined, 'body KHÔNG được chứa refresh_token');
    const setCookie = res.headers['set-cookie'] ?? [];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    assert.match(cookieStr, /refresh_token=[^;]+/, 'phải Set-Cookie refresh_token');
    assert.match(cookieStr, /httponly/i, 'cookie phải HttpOnly');
    assert.match(cookieStr, /samesite=strict/i, 'cookie phải SameSite=Strict');
    assert.match(cookieStr, /path=\/api\/v1\/auth/i, 'cookie path phải là /api/v1/auth');
  });

  it('refresh bằng cookie -> cặp mới + cookie xoay; logout -> cookie bị xóa', async () => {
    const login = await request(
      'POST',
      '/api/v1/auth/login',
      {},
      { username: 'admin', password: 'Matkhau123' }
    );
    const cookie1 = refreshCookieValue(login.headers['set-cookie']);
    assert.ok(cookie1);

    // Refresh: gửi cookie, không body
    const ref = await request('POST', '/api/v1/auth/refresh', { cookie: `refresh_token=${cookie1}` });
    assert.equal(ref.status, 200);
    const refBody = ref.body as { token?: string; refresh_token?: string };
    assert.ok(refBody.token);
    assert.equal(refBody.refresh_token, undefined);
    const cookie2 = refreshCookieValue(ref.headers['set-cookie']);
    assert.ok(cookie2 && cookie2 !== cookie1, 'cookie phải được xoay');

    // Anti-CSRF: Origin lạ -> 403 (dù cookie hợp lệ)
    const csrf = await request(
      'POST',
      '/api/v1/auth/refresh',
      { cookie: `refresh_token=${cookie2}`, origin: 'https://evil.com' },
      {}
    );
    assert.equal(csrf.status, 403);

    // Logout: thu hồi + xóa cookie
    const out = await request('POST', '/api/v1/auth/logout', { cookie: `refresh_token=${cookie2}` });
    assert.equal(out.status, 200);
    const outCookies = [...(out.headers['set-cookie'] ?? [])].join(';');
    assert.match(outCookies, /refresh_token=;/, 'cookie phải bị xóa (giá trị rỗng)');

    // Dùng lại cookie đã logout -> 401 (revoke không qua rotation nên không có grace)
    const reuse = await request('POST', '/api/v1/auth/refresh', { cookie: `refresh_token=${cookie2}` });
    assert.equal(reuse.status, 401);
  });

  it('refresh không có cookie -> 400', async () => {
    const res = await request('POST', '/api/v1/auth/refresh', {}, {});
    assert.equal(res.status, 400);
  });
});
