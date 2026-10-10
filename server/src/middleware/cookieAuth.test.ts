/**
 * Unit test cho cookieAuth (D4): parse cookie thủ công, set/clear cookie,
 * anti-CSRF requireSameOrigin. Không cần DB nên chạy được mọi nơi.
 */
// Không chạm DB nhưng env.ts vẫn đòi DATABASE_URL lúc import
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_COOKIE,
  getRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
  requireSameOrigin,
} from './cookieAuth';

function mockReq(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { cookie: lower['cookie'] },
    get: (name: string) => lower[name.toLowerCase()],
  } as never;
}

describe('getRefreshCookie', () => {
  it('đọc đúng cookie giữa nhiều cookie khác', () => {
    const req = mockReq({ cookie: 'a=1; refresh_token=abc123; b=2' });
    assert.equal(getRefreshCookie(req), 'abc123');
  });
  it('trả undefined khi không có cookie', () => {
    assert.equal(getRefreshCookie(mockReq()), undefined);
    assert.equal(getRefreshCookie(mockReq({ cookie: 'a=1' })), undefined);
  });
  it('không nhầm với tên cookie là prefix (refresh_token_x)', () => {
    const req = mockReq({ cookie: 'refresh_token_x=zzz' });
    assert.equal(getRefreshCookie(req), undefined);
  });
});

describe('setRefreshCookie / clearRefreshCookie', () => {
  it('set cookie HttpOnly + SameSite=strict + đúng path', () => {
    // Gom calls vào mảng: tránh bẫy narrowing của TS với `let x: T | null`
    // gán trong closure mock (TS coi closure chưa từng chạy -> x vẫn null).
    const calls: Array<{ name: string; val: string; opts: Record<string, unknown> }> = [];
    const res = {
      cookie: (name: string, val: string, opts: Record<string, unknown>) => {
        calls.push({ name, val, opts });
      },
    } as unknown as Parameters<typeof setRefreshCookie>[0];
    setRefreshCookie(res, 'rawtoken', '/api/v1/auth');
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.name, REFRESH_COOKIE);
    assert.equal(c.val, 'rawtoken');
    assert.equal(c.opts.httpOnly, true);
    assert.equal(c.opts.sameSite, 'strict');
    assert.equal(c.opts.path, '/api/v1/auth');
    assert.ok((c.opts.maxAge as number) > 0);
  });
  it('clear cookie gọi clearCookie cùng tên và path', () => {
    const calls: Array<{ name: string; opts: Record<string, unknown> }> = [];
    const res = {
      clearCookie: (name: string, opts: Record<string, unknown>) => {
        calls.push({ name, opts });
      },
    } as unknown as Parameters<typeof clearRefreshCookie>[0];
    clearRefreshCookie(res, '/api/v1/parent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, REFRESH_COOKIE);
    assert.equal(calls[0].opts.path, '/api/v1/parent');
  });
});

describe('requireSameOrigin (anti-CSRF)', () => {
  function run(headers: Record<string, string>) {
    let status = 0;
    let body: unknown = null;
    let nexted = false;
    const res = {
      status: (c: number) => {
        status = c;
        return { json: (b: unknown) => (body = b) };
      },
    } as never;
    requireSameOrigin(mockReq(headers), res, () => (nexted = true));
    return { status, body, nexted };
  }

  it('không có Origin/Referer (curl, mobile) -> cho qua', () => {
    assert.equal(run({}).nexted, true);
  });
  it('Origin trong allowlist -> cho qua', () => {
    // CORS_ORIGIN mặc định có http://localhost:5173
    assert.equal(run({ origin: 'http://localhost:5173' }).nexted, true);
  });
  it('Origin lạ -> 403', () => {
    const r = run({ origin: 'https://evil.com' });
    assert.equal(r.nexted, false);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'FORBIDDEN');
  });
  it('không Origin nhưng Referer lạ -> 403', () => {
    const r = run({ referer: 'https://evil.com/login' });
    assert.equal(r.status, 403);
  });
  it('không Origin nhưng Referer hợp lệ -> cho qua', () => {
    assert.equal(run({ referer: 'http://localhost:5173/login' }).nexted, true);
  });
});
