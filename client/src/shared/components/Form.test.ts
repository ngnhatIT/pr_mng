import { describe, it, expect } from 'vitest';
import { moneyDigits } from './Form';

describe('moneyDigits (MoneyInput)', () => {
  it('giữ chữ số, bỏ dấu phân cách hàng nghìn / đơn vị', () => {
    expect(moneyDigits('1.500.000')).toBe('1500000');
    expect(moneyDigits('1,500,000 VND')).toBe('1500000');
    expect(moneyDigits('')).toBe('');
    expect(moneyDigits(null)).toBe('');
  });
  it('numeric từ DB / number: không nhân 100 phần thập phân', () => {
    expect(moneyDigits('1500000.00')).toBe('1500000');
    expect(moneyDigits(1500000.4)).toBe('1500000');
    expect(moneyDigits(NaN)).toBe('');
  });
});
