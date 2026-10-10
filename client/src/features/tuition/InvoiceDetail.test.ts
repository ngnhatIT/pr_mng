import { describe, it, expect } from 'vitest';
import { remainingOf, paymentMethodLabel } from './InvoiceDetail';

const fakeT = (key: string) => `[${key}]`;

describe('remainingOf - còn nợ = tổng trừ đã thu', () => {
  it('trừ đúng khi đã thu một phần', () => {
    expect(remainingOf({ amount: 2000000, paid: 500000 })).toBe(1500000);
  });
  it('paid null/undefined coi như 0', () => {
    expect(remainingOf({ amount: 2000000, paid: null })).toBe(2000000);
    expect(remainingOf({ amount: 2000000 })).toBe(2000000);
  });
  it('thu đủ thì còn nợ bằng 0', () => {
    expect(remainingOf({ amount: 1000000, paid: 1000000 })).toBe(0);
  });
});

describe('paymentMethodLabel - map chuỗi legacy DB sang i18n', () => {
  it('method null trả về null (hiển thị EmptyCell)', () => {
    expect(paymentMethodLabel(null, fakeT)).toBeNull();
  });
  it('chuỗi legacy "Tiền mặt" map đúng key pay.methods.cash', () => {
    expect(paymentMethodLabel('Tiền mặt', fakeT)).toBe('[pay.methods.cash]');
    expect(paymentMethodLabel('Chuyển khoản', fakeT)).toBe('[pay.methods.transfer]');
  });
  it('chuỗi lạ (vnpay, QR...) giữ nguyên để không mất thông tin', () => {
    expect(paymentMethodLabel('vnpay', fakeT)).toBe('vnpay');
  });
});
