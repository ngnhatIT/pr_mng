/**
 * Idempotency-Key (SEC-3/IDEM-1): giữ chỗ nguyên tử trước handler.
 * - 2 request trùng key chạy song song -> handler chỉ chạy 1 lần, request kia 409
 * - key đã xong -> replay; khác body/path -> 422; khác user -> độc lập; handler lỗi -> nhả key
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { setupTestDb, resetTestDb, teardownTestDb } from '../db/test-utils';
import { idempotency } from './idempotency';

let server: http.Server;
let port = 0;
let runs = 0;

function post(
  path: string,
  key: string,
  body: unknown,
  user = '1'
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Idempotency-Key': key,
          'x-user': user,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('idempotency middleware', () => {
  before(async () => {
    await setupTestDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { user?: unknown }).user = { id: Number(req.get('x-user')), role: 'staff' };
      next();
    });
    app.post('/pay', idempotency, async (req, res) => {
      runs++;
      await new Promise((r) => setTimeout(r, 150)); // handler chậm -> request trùng đến khi đang chạy
      if ((req.body as { fail?: boolean }).fail) {
        res.status(400).json({ error: 'fail' });
        return;
      }
      res.status(201).json({ run: runs });
    });
    app.post('/refund', idempotency, (_req, res) => {
      res.status(201).json({ refunded: true });
    });
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as { port: number }).port;
  });
  beforeEach(async () => {
    await resetTestDb();
    runs = 0;
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await teardownTestDb();
  });

  it('2 request đồng thời cùng key -> handler chạy đúng 1 lần, request kia 409', async () => {
    const [a, b] = await Promise.all([
      post('/pay', 'key-concurrent-1', { amount: 500 }),
      post('/pay', 'key-concurrent-1', { amount: 500 }),
    ]);
    assert.equal(runs, 1);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    // Retry sau khi xong -> replay đúng response cũ, không chạy lại
    const c = await post('/pay', 'key-concurrent-1', { amount: 500 });
    assert.equal(c.status, 201);
    assert.deepEqual(c.body, { run: 1 });
    assert.equal(runs, 1);
  });

  it('cùng key khác body hoặc khác path -> 422; user khác -> độc lập', async () => {
    assert.equal((await post('/pay', 'key-reuse-0001', { amount: 1 })).status, 201);
    assert.equal((await post('/pay', 'key-reuse-0001', { amount: 2 })).status, 422);
    assert.equal((await post('/refund', 'key-reuse-0001', { amount: 1 })).status, 422);
    const other = await post('/pay', 'key-reuse-0001', { amount: 1 }, '2');
    assert.equal(other.status, 201);
    assert.equal(runs, 2);
  });

  it('handler lỗi (không 2xx) -> nhả key, retry chạy lại được', async () => {
    assert.equal((await post('/pay', 'key-fail-00001', { fail: true })).status, 400);
    assert.equal((await post('/pay', 'key-fail-00001', { fail: true })).status, 400);
    assert.equal(runs, 2);
  });
});
