/** Unit test cho shared/validate.ts — chạy bằng: node --test dist/shared/validate.test.js */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate, v, paramId } from './validate';
import { AppError } from './errors';

describe('validate()', () => {
  it('chấp nhận input hợp lệ và trim string', () => {
    const out = validate(
      { name: '  An  ', age: '20' },
      {
        name: v.string({ required: true, max: 100, label: 'Tên' }),
        age: v.number({ integer: true, label: 'Tuổi' }),
      }
    );
    assert.equal(out.name, 'An');
    assert.equal(out.age, 20);
  });

  it('ném 400 khi thiếu trường required', () => {
    assert.throws(
      () => validate({}, { name: v.string({ required: true, label: 'Tên' }) }),
      (e: unknown) => e instanceof AppError && e.statusCode === 400 && /bắt buộc/.test(e.message)
    );
  });

  it('ném 400 khi string quá dài / quá ngắn', () => {
    assert.throws(() => validate({ s: 'abcdef' }, { s: v.string({ max: 3 }) }), AppError);
    assert.throws(() => validate({ s: 'ab' }, { s: v.string({ min: 5 }) }), AppError);
  });

  it('ném 400 khi sai pattern', () => {
    assert.throws(
      () => validate({ phone: '123' }, { phone: v.string({ pattern: /^0\d{9}$/, label: 'SĐT' }) }),
      (e: unknown) => e instanceof AppError && /định dạng/.test((e as Error).message)
    );
  });

  it('ném 400 khi number không phải số / không nguyên / ngoài min-max', () => {
    assert.throws(() => validate({ n: 'abc' }, { n: v.number() }), AppError);
    assert.throws(() => validate({ n: 1.5 }, { n: v.number({ integer: true }) }), AppError);
    assert.throws(() => validate({ n: -1 }, { n: v.number({ min: 0 }) }), AppError);
    assert.throws(() => validate({ n: 101 }, { n: v.number({ max: 100 }) }), AppError);
  });

  it('boolean chấp nhận true/"true"/1', () => {
    const out = validate(
      { a: 'true', b: 1, c: 0 },
      {
        a: v.boolean(),
        b: v.boolean(),
        c: v.boolean(),
      }
    );
    assert.equal(out.a, true);
    assert.equal(out.b, true);
    assert.equal(out.c, false);
  });

  it('trường optional thiếu -> undefined, không ném', () => {
    const out = validate({}, { note: v.string({ max: 500 }) });
    assert.equal(out.note, undefined);
  });

  it('enum chỉ chấp nhận giá trị trong danh sách', () => {
    const ok = validate({ s: 'paid' }, { s: v.string({ enum: ['unpaid', 'paid'] }) });
    assert.equal(ok.s, 'paid');
    assert.throws(() => validate({ s: 'x' }, { s: v.string({ enum: ['unpaid', 'paid'] }) }), AppError);
  });
});

describe('paramId()', () => {
  it('trả về số nguyên dương', () => {
    assert.equal(paramId({ id: '42' }), 42);
  });
  it('ném 400 với id không hợp lệ', () => {
    assert.throws(() => paramId({ id: 'abc' }), AppError);
    assert.throws(() => paramId({ id: '0' }), AppError);
    assert.throws(() => paramId({ id: '-5' }), AppError);
  });
});
