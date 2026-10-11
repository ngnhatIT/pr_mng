/**
 * CI-3: POST /leaves/:id/approve | /reject — phạm vi trung tâm (404), 409 khi quyết định lần 2,
 * gợi ý học bù chỉ gồm buổi bị miss trong khoảng nghỉ. Cần PostgreSQL (database test riêng).
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
let classId: number;
let studentId: number;
let adminToken: string;
let otherAdminToken: string;

async function newLeave(): Promise<number> {
  return insertId(
    "INSERT INTO leave_requests (center_id, student_id, class_id, from_date, to_date, reason) VALUES (?, ?, ?, '2030-01-05', '2030-01-07', 'ốm')",
    centerId,
    studentId,
    classId
  );
}

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
  classId = await insertId("INSERT INTO classes (center_id, name) VALUES (?, 'Lớp A')", centerId);
  studentId = await insertId(
    "INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HV Một', ?)",
    centerId
  );
  for (const d of ['2030-01-03', '2030-01-06', '2030-01-09']) {
    await db.prepare('INSERT INTO sessions (class_id, date) VALUES (?, ?)').run(classId, d);
  }
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

describe('POST /api/v1/leaves/:id/approve | reject', () => {
  it('khác trung tâm → 404, đơn vẫn pending', async () => {
    const id = await newLeave();
    assert.equal((await call('POST', `/api/v1/leaves/${id}/approve`, otherAdminToken)).status, 404);
    assert.equal((await call('POST', `/api/v1/leaves/${id}/reject`, otherAdminToken)).status, 404);
    const row = (await db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(id)) as {
      status: string;
    };
    assert.equal(row.status, 'pending');
  });

  it('duyệt → 200 + gợi ý học bù trong khoảng nghỉ + audit; duyệt/từ chối lần 2 → 409', async () => {
    const id = await newLeave();
    const r = await call('POST', `/api/v1/leaves/${id}/approve`, adminToken);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.suggestions.map((s: { date: string }) => s.date),
      ['2030-01-06']
    );
    const row = (await db.prepare('SELECT status, decided_by FROM leave_requests WHERE id = ?').get(id)) as {
      status: string;
      decided_by: number | null;
    };
    assert.equal(row.status, 'approved');
    assert.notEqual(row.decided_by, null);
    assert.ok(
      await db
        .prepare("SELECT 1 FROM audit_logs WHERE entity = 'leave_requests' AND action = 'approve'")
        .get()
    );
    assert.equal((await call('POST', `/api/v1/leaves/${id}/approve`, adminToken)).status, 409);
    assert.equal((await call('POST', `/api/v1/leaves/${id}/reject`, adminToken)).status, 409);
  });

  it('từ chối → 200 rejected; duyệt sau đó → 409', async () => {
    const id = await newLeave();
    const r = await call('POST', `/api/v1/leaves/${id}/reject`, adminToken);
    assert.equal(r.status, 200);
    const row = (await db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(id)) as {
      status: string;
    };
    assert.equal(row.status, 'rejected');
    assert.equal((await call('POST', `/api/v1/leaves/${id}/approve`, adminToken)).status, 409);
  });
});
