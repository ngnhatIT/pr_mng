/** Unit test cho shared/errors.ts + shared/http.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './errors';
import { asyncHandler } from './http';

describe('AppError', () => {
  it('các factory tạo đúng statusCode và code', () => {
    assert.equal(AppError.badRequest('x').statusCode, 400);
    assert.equal(AppError.badRequest('x').code, 'BAD_REQUEST');
    assert.equal(AppError.unauthorized().statusCode, 401);
    assert.equal(AppError.forbidden().statusCode, 403);
    assert.equal(AppError.notFound().statusCode, 404);
    assert.equal(AppError.conflict('x').statusCode, 409);
    assert.equal(AppError.tooManyRequests('x').statusCode, 429);
  });

  it('là Error thật, giữ message', () => {
    const e = AppError.notFound('Không tìm thấy lớp');
    assert.ok(e instanceof Error);
    assert.ok(e instanceof AppError);
    assert.equal(e.message, 'Không tìm thấy lớp');
  });
});

describe('asyncHandler', () => {
  it('chuyển lỗi async sang next()', async () => {
    const boom = new Error('boom');
    let captured: unknown;
    const next = (e?: unknown): void => {
      captured = e;
    };
    const handler = asyncHandler(async () => {
      throw boom;
    });
    await handler({} as never, {} as never, next as never);
    assert.equal(captured, boom);
  });

  it('không gọi next khi handler thành công', async () => {
    let nextCalled = false;
    let jsonValue: unknown;
    const handler = asyncHandler(async (_req, res) => {
      (res as { json: (v: unknown) => void }).json({ ok: true });
    });
    await handler(
      {} as never,
      {
        json: (v: unknown) => {
          jsonValue = v;
        },
      } as never,
      (() => {
        nextCalled = true;
      }) as never
    );
    assert.equal(nextCalled, false);
    assert.deepEqual(jsonValue, { ok: true });
  });
});
