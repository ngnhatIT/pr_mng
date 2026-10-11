import { describe, it, expect } from 'vitest';
import { paidOf } from './InvoiceDetail';
import { paymentMethodLabel } from './tuition.api';

const fakeT = (key: string) => `[${key}]`;

describe('paidOf - số đã thu của hóa đơn (ADM-3)', () => {
  it('ưu tiên paid server trả về', () => {
    expect(paidOf({ paid: 500000 }, [{ amount: 1, status: 'confirmed' }])).toBe(500000);
  });
  it('thiếu paid thì cộng thanh toán đã xác nhận, trừ dòng hoàn tiền (âm), bỏ pending/rejected', () => {
    const payments = [
      { amount: 1000000, status: 'confirmed' as const },
      { amount: -200000, status: 'confirmed' as const },
      { amount: 700000, status: 'pending' as const },
      { amount: 300000, status: 'rejected' as const },
    ];
    expect(paidOf({}, payments)).toBe(800000);
    expect(paidOf({ paid: null }, [])).toBe(0);
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
  it('dòng hoàn tiền/credit được dịch (ADM-19)', () => {
    expect(paymentMethodLabel('refund', fakeT)).toBe('[pay.methods.refund]');
    expect(paymentMethodLabel('credit', fakeT)).toBe('[pay.methods.credit]');
  });
  it('chuỗi lạ (vnpay, QR...) giữ nguyên để không mất thông tin', () => {
    expect(paymentMethodLabel('vnpay', fakeT)).toBe('vnpay');
  });
});
