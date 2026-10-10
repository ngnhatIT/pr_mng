import { describe, it, expect } from 'vitest';
import { isValidVNPhone } from './validation';

describe('isValidVNPhone', () => {
  it('chấp nhận SĐT di động 10 số bắt đầu bằng 0', () => {
    expect(isValidVNPhone('0912345678')).toBe(true);
    expect(isValidVNPhone('033 456 7890')).toBe(true);
  });
  it('chấp nhận đầu số +84', () => {
    expect(isValidVNPhone('+84912345678')).toBe(true);
  });
  it('từ chối SĐT sai định dạng', () => {
    expect(isValidVNPhone('')).toBe(false);
    expect(isValidVNPhone('123456789')).toBe(false); // thiếu số 0 đầu
    expect(isValidVNPhone('091234567')).toBe(false); // thiếu 1 số
    expect(isValidVNPhone('09123456789')).toBe(false); // thừa 1 số
    expect(isValidVNPhone('09a2345678')).toBe(false); // lẫn chữ
  });
});
