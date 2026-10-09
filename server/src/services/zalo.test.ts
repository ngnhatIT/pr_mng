import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, maskAccessToken, formatMoneyVND, formatDueDate } from './zalo.js';

/**
 * Test cho Zalo service — module gửi tiền thật (ZNS tính phí/tin).
 * Các hàm pure (không gọi API) phải đúng 100% để tránh gửi sai.
 */
describe('normalizePhone', () => {
  it('chấp nhận 09xxxxxxxx', () => {
    assert.equal(normalizePhone('0901234567'), '0901234567');
  });
  it('chấp nhận +849xxxxxxxx', () => {
    assert.equal(normalizePhone('+84901234567'), '0901234567');
  });
  it('chấp nhận 849xxxxxxxx (11 số)', () => {
    assert.equal(normalizePhone('84901234567'), '0901234567');
  });
  it('loại bỏ khoảng trắng/dấu chấm/gạch', () => {
    assert.equal(normalizePhone('0901 234 567'), '0901234567');
    assert.equal(normalizePhone('0901.234.567'), '0901234567');
    assert.equal(normalizePhone('0901-234-567'), '0901234567');
  });
  it('từ chối số không hợp lệ', () => {
    assert.equal(normalizePhone('123'), null);
    assert.equal(normalizePhone('090123456'), null); // 9 số
    assert.equal(normalizePhone('09012345678'), null); // 11 số
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone(undefined), null);
  });
});

describe('maskAccessToken', () => {
  it('che giữa token', () => {
    assert.equal(maskAccessToken('abcdefghij123456'), 'abcd••••••••3456');
  });
  it('token ngắn che hết', () => {
    assert.equal(maskAccessToken('abc'), '••••••••');
  });
  it('token rỗng', () => {
    assert.equal(maskAccessToken(''), '');
  });
});

describe('formatMoneyVND', () => {
  it('format tiền Việt', () => {
    assert.equal(formatMoneyVND(1000000), '1.000.000đ');
    assert.equal(formatMoneyVND(0), '0đ');
  });
  it('làm tròn', () => {
    assert.equal(formatMoneyVND(999.6), '1.000đ');
  });
});

describe('formatDueDate', () => {
  it('format YYYY-MM-DD sang DD/MM/YYYY', () => {
    assert.equal(formatDueDate('2026-10-15'), '15/10/2026');
  });
  it('null trả gạch ngang', () => {
    assert.equal(formatDueDate(null), '—');
  });
});
