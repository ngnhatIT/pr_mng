import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertStrongPassword } from './password.js';

describe('assertStrongPassword', () => {
  it('chấp nhận mật khẩu đủ mạnh', () => {
    assert.doesNotThrow(() => assertStrongPassword('MySecure123'));
    assert.doesNotThrow(() => assertStrongPassword('x'.repeat(8)));
  });
  it('từ chối mật khẩu ngắn hơn 8 ký tự', () => {
    assert.throws(() => assertStrongPassword('abc'), /8 ký tự/);
    assert.throws(() => assertStrongPassword('1234567'), /8 ký tự/);
    assert.throws(() => assertStrongPassword(''), /8 ký tự/);
  });
  it('từ chối mật khẩu phổ biến', () => {
    assert.throws(() => assertStrongPassword('12345678'), /quá đơn giản/);
    assert.throws(() => assertStrongPassword('password'), /quá đơn giản/);
    assert.throws(() => assertStrongPassword('Qwerty123'), /quá đơn giản/);
    assert.throws(() => assertStrongPassword('ADMIN123'), /quá đơn giản/);
  });
  it('mã lỗi là WEAK_PASSWORD', () => {
    try {
      assertStrongPassword('123');
      assert.fail('phải ném lỗi');
    } catch (err) {
      assert.equal((err as { code?: string }).code, 'WEAK_PASSWORD');
    }
  });
});
