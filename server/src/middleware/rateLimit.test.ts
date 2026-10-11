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
    listeners: {} as Record<string, () => void>,
    on(ev: string, fn: () => void) {
      this.listeners[ev] = fn;
    },
  };
}

// Gửi 1 request qua limiter, trả về status
function hit(limiter: (req: never, res: never, next: never) => void, req: never) {
  const res = mockRes();
  let nextCalled = false;
  limiter(
    req,
    res as never,
    (() => {
      nextCalled = true;
    }) as never
  );
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
    limiter(
      u,
      res as never,
      (() => {
        nextCalled = true;
      }) as never
    );
    assert.equal(res.statusCode, 429);
    assert.equal(nextCalled, false);
    assert.equal((res.body as { code: string }).code, 'RATE_LIMITED');
    assert.ok(Number(res.headers['Retry-After']) >= 1);
  });
});

describe('B2: RATE_LIMIT_DIVISOR chia quota theo số worker', () => {
  it('divisor 2: max 10 → 5 hiệu dụng trên mỗi worker', async () => {
    const { env: envMod } = await import('../config/env');
    const prev = envMod.RATE_LIMIT_DIVISOR;
    (envMod as { RATE_LIMIT_DIVISOR: number }).RATE_LIMIT_DIVISOR = 2;
    try {
      const { createRateLimit: make } = await import('./rateLimit');
      const limiter = make({ windowMs: 60_000, max: 10 });
      for (let i = 0; i < 5; i++) assert.equal(hit(limiter, mockReq()).status, 200);
      assert.equal(hit(limiter, mockReq()).status, 429); // request thứ 6 bị chặn
    } finally {
      (envMod as { RATE_LIMIT_DIVISOR: number }).RATE_LIMIT_DIVISOR = prev;
    }
  });

  it('divisor 1 (mặc định): max giữ nguyên', async () => {
    const { createRateLimit: make } = await import('./rateLimit');
    const limiter = make({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) assert.equal(hit(limiter, mockReq()).status, 200);
    assert.equal(hit(limiter, mockReq()).status, 429);
  });
});

describe('D5: login rate limit theo tài khoản', () => {
  async function withEnv(patch: Record<string, number>, fn: () => void | Promise<void>) {
    const { env: envMod } = await import('../config/env');
    const rec = envMod as unknown as Record<string, number>;
    const prev: Record<string, number> = {};
    for (const k of Object.keys(patch)) prev[k] = rec[k];
    Object.assign(rec, patch);
    try {
      await fn();
    } finally {
      Object.assign(rec, prev);
    }
  }

  function loginReq(username: string, ip: string) {
    return {
      body: { username },
      socket: { remoteAddress: ip },
      ip,
      path: '/api/auth/login',
    } as never;
  }

  it('cùng IP khác username không chia quota', async () => {
    await withEnv({ LOGIN_RATE_LIMIT: 100, LOGIN_ACCOUNT_RATE_LIMIT: 2 }, async () => {
      const { loginRateLimit: rl } = await import('./rateLimit');
      const ip = '198.51.100.7';
      assert.equal(hit(rl, loginReq('alice', ip)).status, 200);
      assert.equal(hit(rl, loginReq('alice', ip)).status, 200);
      assert.equal(hit(rl, loginReq('alice', ip)).status, 429); // alice hết quota tài khoản
      assert.equal(hit(rl, loginReq('bob', ip)).status, 200); // bob cùng IP không bị ảnh hưởng
    });
  });

  it('cùng username quá 20 lần → 429 (normalize chữ hoa/khoảng trắng)', async () => {
    await withEnv({ LOGIN_RATE_LIMIT: 1000 }, async () => {
      const { loginRateLimit: rl } = await import('./rateLimit');
      const ip = '198.51.100.8';
      for (let i = 0; i < 20; i++) {
        assert.equal(hit(rl, loginReq(i % 2 ? 'Charlie' : ' charlie ', ip)).status, 200);
      }
      assert.equal(hit(rl, loginReq('CHARLIE', ip)).status, 429);
    });
  });

  function phoneReq(phone: string, ip: string) {
    return { body: { phone }, socket: { remoteAddress: ip }, ip, path: '/forgot-password' } as never;
  }

  it('SEC-8: SĐT nhiều định dạng (0/+84/84) chung 1 bucket tài khoản', async () => {
    await withEnv({ LOGIN_RATE_LIMIT: 1000, LOGIN_ACCOUNT_RATE_LIMIT: 3 }, async () => {
      const { loginRateLimit: rl } = await import('./rateLimit');
      const ip = '198.51.100.9';
      assert.equal(hit(rl, phoneReq('0912345678', ip)).status, 200);
      assert.equal(hit(rl, phoneReq('+84912345678', ip)).status, 200);
      assert.equal(hit(rl, phoneReq('84 912 345 678', ip)).status, 200);
      assert.equal(hit(rl, phoneReq('0912.345.678', ip)).status, 429);
    });
  });

  it('SEC-8: đăng nhập thành công được hoàn lại hit (chính chủ không tự khóa mình)', async () => {
    await withEnv({ LOGIN_RATE_LIMIT: 1000, LOGIN_ACCOUNT_RATE_LIMIT: 1 }, async () => {
      const { loginRateLimit: rl } = await import('./rateLimit');
      const ip = '198.51.100.10';
      for (let i = 0; i < 3; i++) {
        const res = mockRes();
        rl(loginReq('dave', ip), res as never, (() => {}) as never);
        assert.equal(res.statusCode, 200);
        res.listeners.finish(); // 200 -> hoàn lại
      }
      const fail = mockRes();
      rl(loginReq('dave', ip), fail as never, (() => {}) as never);
      fail.statusCode = 401;
      fail.listeners.finish(); // sai mật khẩu -> giữ hit
      assert.equal(hit(rl, loginReq('dave', ip)).status, 429);
    });
  });

  it('S-4: kẻ tấn công làm cạn bucket tài khoản; chính chủ có device cookie hợp lệ vẫn đăng nhập được', async () => {
    await withEnv({ LOGIN_RATE_LIMIT: 1000, LOGIN_ACCOUNT_RATE_LIMIT: 3 }, async () => {
      const { loginRateLimit: rl } = await import('./rateLimit');
      const { deviceToken } = await import('./cookieAuth');
      const withCookie = (cookie: string) =>
        ({ ...(loginReq('erin', '198.51.100.21') as object), headers: { cookie } }) as never;
      // Kẻ tấn công từ IP A sai liên tục -> bucket ẩn danh của 'erin' cạn
      for (let i = 0; i < 3; i++) assert.equal(hit(rl, loginReq('erin', '198.51.100.20')).status, 200);
      assert.equal(hit(rl, loginReq('erin', '198.51.100.21')).status, 429, 'không cookie -> 429');
      assert.equal(hit(rl, withCookie('ld=gia-mao')).status, 429, 'cookie giả -> vẫn bucket ẩn danh');
      assert.equal(hit(rl, withCookie(`ld=${deviceToken('parent', 'erin')}`)).status, 429, 'sai kind -> 429');
      const mine = deviceToken('staff', 'erin');
      assert.equal(hit(rl, withCookie(`a=1; ld=${mine}`)).status, 200, 'thiết bị quen -> qua');
      // J-A6: cookie hết hạn -> bucket ẩn danh; cookie bị lộ rút cạn chỉ bucket của chính nó
      const expired = deviceToken('staff', 'erin', Date.now() - 91 * 24 * 3600 * 1000);
      assert.equal(hit(rl, withCookie(`ld=${expired}`)).status, 429, 'cookie hết hạn -> 429');
      const leaked = deviceToken('staff', 'erin');
      for (let i = 0; i < 3; i++) hit(rl, withCookie(`ld=${leaked}`));
      assert.equal(hit(rl, withCookie(`ld=${leaked}`)).status, 429, 'cookie lộ: cạn bucket của nó');
      assert.equal(hit(rl, withCookie(`ld=${mine}`)).status, 200, 'thiết bị khác của chính chủ vẫn qua');
      assert.notEqual(
        deviceToken('staff', 'erin'),
        deviceToken('staff', 'erin'),
        'mỗi lần đăng nhập 1 cookie mới'
      );
    });
  });
});

describe('CORR-3: publicRateLimit tách bucket theo route', () => {
  it('2 route khác nhau không chia chung bộ đếm cùng IP', async () => {
    const { publicRateLimit } = await import('./rateLimit');
    const a = publicRateLimit(1);
    const b = publicRateLimit(1);
    const req = () => ({ socket: { remoteAddress: '192.0.2.50' }, ip: '192.0.2.50' }) as never;
    assert.equal(hit(a, req()).status, 200);
    assert.equal(hit(a, req()).status, 429);
    assert.equal(hit(b, req()).status, 200);
  });
});
