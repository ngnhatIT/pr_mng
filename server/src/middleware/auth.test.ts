/** Unit test cho D2 (thu hồi access token) — phần không cần DB. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  requireAuth,
  signToken,
  invalidateTokenCheck,
  reqCenterId,
  requireCenterId,
  type AuthUser,
  type AuthRequest,
} from './auth';

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
  it('C-6: token không có tv → 401 TOKEN_REVOKED, không cần DB', async () => {
    const user: AuthUser = { id: 1, username: 'a', role: 'staff', name: 'A', kind: 'staff' };
    const req = mockReq(signToken(user));
    const res = mockRes() as unknown as { statusCode: number; body: { code: string } };
    const passed = await throughAuth(req, res as never);
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'TOKEN_REVOKED');
    assert.equal(req.user, undefined);
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

describe('reqCenterId / requireCenterId (superadmin chọn trung tâm)', () => {
  const ctx = (role: string, center_id: number | null, query: Record<string, unknown> = {}, body = {}) =>
    ({ user: { id: 1, role, center_id }, query, body }) as unknown as AuthRequest;

  it('user thường: luôn là center của mình, bỏ qua ?center_id', () => {
    assert.equal(reqCenterId(ctx('admin', 5, { center_id: '9' })), 5);
  });
  it('user thường không có center -> 403 (fail-closed)', () => {
    assert.throws(() => reqCenterId(ctx('staff', null)), /chưa được gán trung tâm/);
  });
  it('superadmin: không chọn -> null (toàn hệ thống); chọn -> thao tác như trung tâm đó', () => {
    assert.equal(reqCenterId(ctx('superadmin', null)), null);
    assert.equal(reqCenterId(ctx('superadmin', null, { center_id: '7' })), 7);
    assert.throws(() => reqCenterId(ctx('superadmin', null, { center_id: 'abc' })), /không hợp lệ/);
  });
  it('requireCenterId: superadmin phải chọn trung tâm (query hoặc body)', () => {
    assert.equal(requireCenterId(ctx('superadmin', null, { center_id: '3' })), 3);
    assert.equal(requireCenterId(ctx('superadmin', null, {}, { center_id: 4 })), 4);
    assert.throws(() => requireCenterId(ctx('superadmin', null)), /cần chọn trung tâm/);
  });
});
