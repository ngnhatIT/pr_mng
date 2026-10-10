/** Unit test cho middleware/rateLimit.ts — key quota theo tài khoản khi đã auth. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { createRateLimit } from './rateLimit';

const IP = '203.0.113.9';

// Ký JWT thật bằng đúng secret/algorithm của app (giống middleware/auth.ts)
function bearer(payload: Record<string, unknown>): string {
  return 'Bearer ' + jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256' });
}

// Mock req/res tối thiểu cho middleware
function mockReq(user?: { id: number; kind?: 'parent' | 'staff' }, token?: string) {
  return { user, headers: { authorization: token }, socket: { remoteAddress: IP }, ip: IP } as never;
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
}

// Gửi 1 request qua limiter, trả về status
function hit(limiter: (req: never, res: never, next: never) => void, req: never) {
  const res = mockRes();
  let nextCalled = false;
  limiter(req, res as never, (() => {
    nextCalled = true;
  }) as never);
  return { status: res.statusCode, nextCalled, remaining: res.headers['X-RateLimit-Remaining'] };
}

describe('createRateLimit key theo tài khoản', () => {
  it('limiter mount trước auth: Bearer token hợp lệ vẫn key theo user (max=1)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const t1 = bearer({ id: 11, kind: 'staff', username: 'a', role: 'staff', name: 'A' });
    const t2 = bearer({ id: 12, kind: 'staff', username: 'b', role: 'staff', name: 'B' });

    assert.equal(hit(limiter, mockReq(undefined, t1)).status, 200);
    assert.equal(hit(limiter, mockReq(undefined, t1)).status, 429); // cùng user hết quota
    assert.equal(hit(limiter, mockReq(undefined, t2)).status, 200); // user khác cùng IP vẫn OK
  });

  it('2 user khác nhau cùng IP không chia quota khi req.user đã có (max=2)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 2 });
    const u1 = mockReq({ id: 1, kind: 'staff' });
    const u2 = mockReq({ id: 2, kind: 'staff' });

    assert.equal(hit(limiter, u1).status, 200);
    assert.equal(hit(limiter, u1).status, 200);
    assert.equal(hit(limiter, u1).status, 429); // user 1 hết quota
    assert.equal(hit(limiter, u2).status, 200); // user 2 vẫn còn nguyên quota
    assert.equal(hit(limiter, u2).status, 200);
    assert.equal(hit(limiter, u2).status, 429);
  });

  it('anonymous cùng IP vẫn bị giới hạn chung theo IP (max=2)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 2 });
    assert.equal(hit(limiter, mockReq()).status, 200);
    assert.equal(hit(limiter, mockReq()).status, 200);
    assert.equal(hit(limiter, mockReq()).status, 429);
  });

  it('parent và staff trùng id số không chia quota (namespace theo kind)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const staff = mockReq({ id: 5, kind: 'staff' });
    const parent = mockReq({ id: 5, kind: 'parent' });

    assert.equal(hit(limiter, staff).status, 200);
    assert.equal(hit(limiter, staff).status, 429);
    assert.equal(hit(limiter, parent).status, 200); // bucket khác
  });

  it('user đã auth không bị ảnh hưởng bởi quota IP của anonymous (max=1)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    assert.equal(hit(limiter, mockReq()).status, 200);
    assert.equal(hit(limiter, mockReq()).status, 429); // IP hết
    assert.equal(hit(limiter, mockReq({ id: 9, kind: 'staff' })).status, 200); // user riêng bucket
  });

  it('token giả/hết hạn → fallback IP, không tự chọn bucket để bypass', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    assert.equal(hit(limiter, mockReq()).status, 200); // anonymous chiếm slot IP
    const forged = 'Bearer ' + jwt.sign({ id: 99, kind: 'staff' }, 'sai-secret-khac', { algorithm: 'HS256' });
    assert.equal(hit(limiter, mockReq(undefined, forged)).status, 429); // vẫn tính vào IP
    const expired = bearer({ id: 99, kind: 'staff', exp: Math.floor(Date.now() / 1000) - 10 });
    assert.equal(hit(limiter, mockReq(undefined, expired)).status, 429); // hết hạn cũng vậy
  });

  it('bị chặn trả 429 + header Retry-After + code RATE_LIMITED', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });
    const u = mockReq({ id: 7, kind: 'staff' });
    hit(limiter, u);
    const res = mockRes();
    let nextCalled = false;
    limiter(u, res as never, (() => {
      nextCalled = true;
    }) as never);
    assert.equal(res.statusCode, 429);
    assert.equal(nextCalled, false);
    assert.equal((res.body as { code: string }).code, 'RATE_LIMITED');
    assert.ok(Number(res.headers['Retry-After']) >= 1);
  });
});
