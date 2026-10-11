/**
 * CI-3: form công khai POST /public/leads | /public/trials (không đăng nhập, nhận PII):
 * nhiều trung tâm + Host lạ → 404 và KHÔNG ghi lead; subdomain đúng → ghi đúng trung tâm, chống gửi trùng,
 * gói basic → 403, mã giới thiệu của chính mình → 400.
 * V-1: form staff POST/PUT /leads chặn chuỗi quá dài. Cần PostgreSQL (database test riêng).
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
  opts: { host?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const buf = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
  const headers: Record<string, string> = { Host: opts.host ?? '127.0.0.1' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
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

const insertId = async (sql: string, ...args: unknown[]) =>
  Number((await db.prepare(sql).run(...args)).lastInsertRowid);
const count = async (sql: string, ...args: unknown[]) =>
  Number(((await db.prepare(sql).get(...args)) as { c: number | string }).c);

let centerA: number;
let centerB: number;
const HOST_A = 'alpha.educenter.test';

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
  centerA = await insertId(
    "INSERT INTO centers (name, subdomain, plan) VALUES ('TT Alpha', 'alpha', 'standard')"
  );
  centerB = await insertId("INSERT INTO centers (name, subdomain, plan) VALUES ('TT Beta', 'beta', 'basic')");
});
after(async () => {
  server.close();
  await teardownTestDb();
});

describe('POST /api/v1/public/leads', () => {
  it('nhiều trung tâm + Host không khớp subdomain → 404, không ghi lead', async () => {
    for (const host of ['unknown.educenter.test', 'localhost']) {
      const r = await call('POST', '/api/v1/public/leads', {
        host,
        body: { name: 'Khách', phone: '0912345678' },
      });
      assert.equal(r.status, 404);
    }
    assert.equal(await count('SELECT COUNT(*) as c FROM leads'), 0);
  });

  it('subdomain đúng → 201, ghi vào đúng trung tâm, SĐT chuẩn hóa; gửi lại ngay → không tạo dòng mới', async () => {
    const body = { name: 'Khách A', phone: '+84 912 345 678', note: 'x'.repeat(5000) };
    assert.equal((await call('POST', '/api/v1/public/leads', { host: HOST_A, body })).status, 201);
    assert.equal((await call('POST', '/api/v1/public/leads', { host: HOST_A, body })).status, 201);
    const rows = (await db.prepare('SELECT center_id, phone, note FROM leads').all()) as {
      center_id: number;
      phone: string;
      note: string;
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].center_id, centerA);
    assert.equal(rows[0].phone, '0912345678');
    assert.equal(rows[0].note.length, 1000); // note bị cắt
  });

  it('gói basic (không có landing) → 403; SĐT sai → 400', async () => {
    const basic = await call('POST', '/api/v1/public/leads', {
      host: 'beta.educenter.test',
      body: { name: 'K', phone: '0912345678' },
    });
    assert.equal(basic.status, 403);
    const bad = await call('POST', '/api/v1/public/leads', {
      host: HOST_A,
      body: { name: 'K', phone: '123' },
    });
    assert.equal(bad.status, 400);
    assert.equal(await count('SELECT COUNT(*) as c FROM leads'), 0);
  });
});

describe('POST /api/v1/public/trials', () => {
  it('nhiều trung tâm + Host lạ → 404, không ghi đăng ký', async () => {
    const r = await call('POST', '/api/v1/public/trials', {
      host: 'nope.educenter.test',
      body: { name: 'K', phone: '0912345678' },
    });
    assert.equal(r.status, 404);
    assert.equal(await count('SELECT COUNT(*) as c FROM trial_registrations'), 0);
  });

  it('lớp của trung tâm khác → 400; mã giới thiệu của chính mình → 400; hợp lệ → 201 + referral pending', async () => {
    const otherClass = await insertId("INSERT INTO classes (center_id, name) VALUES (?, 'Lớp B')", centerB);
    const r1 = await call('POST', '/api/v1/public/trials', {
      host: HOST_A,
      body: { name: 'K', phone: '0912345678', class_id: otherClass },
    });
    assert.equal(r1.status, 400);
    const pid = await insertId(
      "INSERT INTO parents (center_id, phone, password_hash, name, referral_code) VALUES (?, '0987654321', 'x', 'PH', 'REF123')",
      centerA
    );
    const self = await call('POST', '/api/v1/public/trials', {
      host: HOST_A,
      body: { name: 'K', phone: '0987654321', referral_code: 'REF123' },
    });
    assert.equal(self.status, 400);
    const ok = await call('POST', '/api/v1/public/trials', {
      host: HOST_A,
      body: { name: 'Bé K', phone: '0912345678', referral_code: 'REF123', desired_date: '2030-02-01' },
    });
    assert.equal(ok.status, 201);
    const t = (await db
      .prepare('SELECT center_id, referral_code, desired_date FROM trial_registrations')
      .get()) as {
      center_id: number;
      referral_code: string;
      desired_date: string;
    };
    assert.deepEqual(t, { center_id: centerA, referral_code: 'REF123', desired_date: '2030-02-01' });
    assert.equal(
      await count(
        "SELECT COUNT(*) as c FROM referrals WHERE referrer_parent_id = ? AND referred_phone = '0912345678' AND status = 'pending'",
        pid
      ),
      1
    );
  });
});

describe('V-1: form staff /leads chặn chuỗi quá dài', () => {
  it('POST note > 1000 ký tự → 400; PUT name > 100 ký tự → 400; dữ liệu hợp lệ vẫn qua', async () => {
    const uid = await insertId(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('adm', 'h', 'admin', 'Adm', ?)",
      centerA
    );
    const token = jwt.sign(
      { id: uid, username: 'adm', role: 'admin', name: 'Adm', kind: 'staff', center_id: centerA, tv: 1 },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const long = await call('POST', '/api/v1/leads', {
      token,
      body: { name: 'K', phone: '0912345678', note: 'x'.repeat(1001) },
    });
    assert.equal(long.status, 400);
    assert.equal(long.body.code, 'VALIDATION_MAX');
    const ok = await call('POST', '/api/v1/leads', { token, body: { name: 'K', phone: '0912345678' } });
    assert.equal(ok.status, 201);
    const put = await call('PUT', `/api/v1/leads/${ok.body.id}`, { token, body: { name: 'n'.repeat(101) } });
    assert.equal(put.status, 400);
    const put2 = await call('PUT', `/api/v1/leads/${ok.body.id}`, { token, body: { note: 'ghi chú' } });
    assert.equal(put2.status, 200);
    assert.equal(put2.body.note, 'ghi chú');
  });
});
