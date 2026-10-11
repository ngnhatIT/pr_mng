/**
 * v30 xác thực 2 lớp qua HTTP thật: thiết lập -> bật (mã khôi phục) -> đăng nhập 2 bước, mã dùng lại bị chặn,
 * mã khôi phục dùng 1 lần, token bước 2 không dùng làm access token, tắt cần mật khẩu + mã.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import bcrypt from 'bcryptjs';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { createApp } from '../../app';
import { totpAt } from '../../shared/totp';

let server: http.Server;
let base = '';

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const step = () => Math.floor(Date.now() / 30000);

before(async () => {
  await setupTestDb();
  await resetTestDb();
  await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
  await db
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (1,'admin',?,'admin','Admin',1)"
    )
    .run(bcrypt.hashSync('Matkhau123', 4));
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await teardownTestDb();
});

describe('xác thực 2 lớp (TOTP)', () => {
  let token = '';
  let secret = '';
  let recovery: string[] = [];

  it('thiết lập + bật: mã sai bị từ chối, mã đúng trả 8 mã khôi phục; secret lưu mã hóa', async () => {
    token = (await call('POST', '/auth/login', { username: 'admin', password: 'Matkhau123' })).body
      .token as string;
    const setup = await call('POST', '/auth/2fa/setup', {}, token);
    secret = setup.body.secret as string;
    assert.match(setup.body.otpauth_url as string, /^otpauth:\/\/totp\//);
    const stored = (await db.prepare('SELECT totp_secret FROM users WHERE id = 1').get()) as {
      totp_secret: string;
    };
    assert.ok(stored.totp_secret.startsWith('v1:') && !stored.totp_secret.includes(secret));

    assert.equal(
      (await call('POST', '/auth/2fa/enable', { code: '000000' }, token)).body.code,
      'MFA_INVALID_CODE'
    );
    const en = await call('POST', '/auth/2fa/enable', { code: totpAt(secret, step()) }, token);
    recovery = en.body.recovery_codes as string[];
    assert.equal(recovery.length, 8);
    assert.deepEqual((await call('GET', '/auth/2fa', undefined, token)).body, {
      enabled: true,
      recovery_left: 8,
    });
  });

  it('đăng nhập 2 bước: không cấp token khi chỉ có mật khẩu; token bước 2 không phải access token', async () => {
    const first = await call('POST', '/auth/login', { username: 'admin', password: 'Matkhau123' });
    assert.equal(first.body.mfa_required, true);
    assert.equal(first.body.token, undefined);
    const mfa = first.body.mfa_token as string;
    assert.equal((await call('GET', '/auth/me', undefined, mfa)).status, 401);

    // mã của bước vừa dùng lúc bật bị chặn (replay); mã bước kế tiếp hợp lệ (đọc bước từ DB: không phụ thuộc mốc 30s)
    const last = Number(
      (
        (await db.prepare('SELECT totp_last_step FROM users WHERE id = 1').get()) as {
          totp_last_step: string;
        }
      ).totp_last_step
    );
    assert.equal(
      (await call('POST', '/auth/login/2fa', { mfa_token: mfa, code: totpAt(secret, last) })).status,
      401
    );
    const ok = await call('POST', '/auth/login/2fa', { mfa_token: mfa, code: totpAt(secret, last + 1) });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
  });

  it('mã khôi phục dùng được đúng 1 lần', async () => {
    const mfa = (await call('POST', '/auth/login', { username: 'admin', password: 'Matkhau123' })).body
      .mfa_token;
    const code = recovery[0].toLowerCase();
    assert.equal((await call('POST', '/auth/login/2fa', { mfa_token: mfa, code })).status, 200);
    assert.equal((await call('POST', '/auth/login/2fa', { mfa_token: mfa, code })).status, 401);
    assert.equal((await call('GET', '/auth/2fa', undefined, token)).body.recovery_left as number, 7);
  });

  it('tắt cần mật khẩu đúng + mã; sau đó đăng nhập lại 1 bước', async () => {
    const bad = await call('POST', '/auth/2fa/disable', { password: 'sai', code: recovery[1] }, token);
    assert.equal(bad.body.code, 'WRONG_PASSWORD');
    assert.equal(
      (await call('POST', '/auth/2fa/disable', { password: 'Matkhau123', code: recovery[1] }, token)).status,
      200
    );
    const again = await call('POST', '/auth/login', { username: 'admin', password: 'Matkhau123' });
    assert.ok(again.body.token);
  });
});
