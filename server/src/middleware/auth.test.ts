/** Unit test cho D2 (thu hồi access token) — phần không cần DB. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { requireAuth, signToken, invalidateTokenCheck, type AuthUser, type AuthRequest } from './auth';

function mockReq(token?: string) {
  return {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
    user: undefined as AuthUser | undefined,
  } as unknown as AuthRequest;
}
function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res as unknown as Parameters<typeof requireAuth>[1];
}

// requireAuth giờ kiểm tra DB bất đồng bộ — chờ next() được gọi
function throughAuth(req: AuthRequest, res: Parameters<typeof requireAuth>[1]): Promise<boolean> {
  return new Promise((resolve) => {
    requireAuth(req, res, (() => resolve(true)) as never);
    // Nếu middleware trả 401/403 đồng bộ hoặc bất đồng bộ mà không gọi next,
    // đợi 1 tick rồi kết luận không qua
    setImmediate(() => resolve(false));
  });
}

describe('D2: requireAuth kiểm tra thu hồi token', () => {
  it('token không có tv (cấp trước D2) → cho qua, không cần DB', async () => {
    const user: AuthUser = { id: 1, username: 'a', role: 'staff', name: 'A', kind: 'staff' };
    const req = mockReq(signToken(user));
    const res = mockRes();
    const passed = await throughAuth(req, res);
    assert.equal(passed, true);
    assert.equal(req.user?.id, 1);
  });

  it('thiếu token → 401 NO_TOKEN', async () => {
    const req = mockReq();
    const res = mockRes() as unknown as { statusCode: number; body: { code: string } };
    const passed = await throughAuth(req, res as never);
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'NO_TOKEN');
  });

  it('token sai chữ ký → 401 INVALID_TOKEN', async () => {
    const bad = jwt.sign({ id: 1 }, 'sai-secret', { algorithm: 'HS256' });
    const req = mockReq(bad);
    const res = mockRes() as unknown as { statusCode: number; body: { code: string } };
    const passed = await throughAuth(req, res as never);
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'INVALID_TOKEN');
  });

  it('invalidateTokenCheck không throw khi cache trống', () => {
    invalidateTokenCheck('staff', 999999);
    invalidateTokenCheck('parent', 999999);
  });
});
