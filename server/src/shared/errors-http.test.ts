/** Unit test cho shared/errors.ts + shared/http.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './errors';
import { asyncHandler, errorHandler } from './http';

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

describe('errorHandler', () => {
  const mockRes = () => {
    const res = {
      statusCode: 0,
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
    return res;
  };
  const req = { requestId: 'test-req-1' } as never;
  const noop = (() => {}) as never;

  it('AppError → đúng status + code + request_id', () => {
    const res = mockRes();
    errorHandler(AppError.notFound('Không thấy'), req, res as never, noop);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Không thấy', code: 'NOT_FOUND', request_id: 'test-req-1' });
  });

  it('JSON sai cú pháp → 400 INVALID_JSON (không phải 500)', () => {
    const err = Object.assign(new SyntaxError('Unexpected token }'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    const res = mockRes();
    errorHandler(err, req, res as never, noop);
    assert.equal(res.statusCode, 400);
    assert.equal((res.body as { code: string }).code, 'INVALID_JSON');
  });

  it('payload >1mb → 413 PAYLOAD_TOO_LARGE (không phải 500)', () => {
    const err = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    const res = mockRes();
    errorHandler(err, req, res as never, noop);
    assert.equal(res.statusCode, 413);
    assert.equal((res.body as { code: string }).code, 'PAYLOAD_TOO_LARGE');
  });

  it('multer LIMIT_FILE_SIZE → 413 FILE_TOO_LARGE', () => {
    const res = mockRes();
    errorHandler(
      Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }),
      req,
      res as never,
      noop
    );
    assert.equal(res.statusCode, 413);
  });

  it('PostgreSQL 23505 → 409 DUPLICATE', () => {
    const res = mockRes();
    errorHandler(Object.assign(new Error('duplicate key'), { code: '23505' }), req, res as never, noop);
    assert.equal(res.statusCode, 409);
    assert.equal((res.body as { code: string }).code, 'DUPLICATE');
  });

  it('lỗi lạ → 500 INTERNAL_ERROR, không lộ stack, có request_id', () => {
    const res = mockRes();
    errorHandler(new Error('secret stack trace'), req, res as never, noop);
    assert.equal(res.statusCode, 500);
    const body = res.body as { error: string; code: string; request_id: string };
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(body.request_id, 'test-req-1');
    assert.ok(!body.error.includes('secret stack trace'));
  });
});
