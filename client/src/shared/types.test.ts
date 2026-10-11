import { describe, it, expect } from 'vitest';
import {
  formatVND,
  formatDate,
  formatDateTime,
  formatScheduleText,
  getDayNames,
  isPastCloseDate,
  remainingOf,
  todayVN,
} from './types';

describe('formatVND', () => {
  it('tiếng Việt: 1.000.000đ', () => {
    expect(formatVND(1000000, 'vi')).toBe('1.000.000đ');
  });
  it('tiếng Anh: 1,000,000 VND', () => {
    expect(formatVND(1000000, 'en')).toBe('1,000,000 VND');
  });
  it('làm tròn số lẻ', () => {
    expect(formatVND(1500.6, 'vi')).toBe('1.501đ');
    expect(formatVND(1500.6, 'en')).toBe('1,501 VND');
  });
  it('số 0', () => {
    expect(formatVND(0, 'vi')).toBe('0đ');
  });
});

describe('formatDate', () => {
  it('đổi YYYY-MM-DD thành DD/MM/YYYY', () => {
    expect(formatDate('2026-10-09')).toBe('09/10/2026');
  });
  it('null/undefined trả về -', () => {
    expect(formatDate(null)).toBe('-');
  });
  it('cắt phần giờ nếu có', () => {
    expect(formatDate('2026-01-05T14:30:00')).toBe('05/01/2026');
  });
});

describe('formatDateTime', () => {
  it('định dạng đầy đủ ngày giờ', () => {
    expect(formatDateTime('2026-10-09T14:30:00')).toBe('09/10/2026 14:30');
  });
  it('null trả về -', () => {
    expect(formatDateTime(null)).toBe('-');
  });
});

describe('formatScheduleText', () => {
  it('nối các buổi học', () => {
    const json = JSON.stringify([
      { day: 1, start: '08:00', end: '09:30' },
      { day: 3, start: '08:00', end: '09:30' },
    ]);
    const text = formatScheduleText(json);
    expect(text).toContain('08:00-09:30');
  });
  it('JSON hỏng trả về chuỗi rỗng', () => {
    expect(formatScheduleText('not-json')).toBe('');
  });
  it('chuỗi rỗng trả về chuỗi rỗng', () => {
    expect(formatScheduleText('')).toBe('');
  });
});

describe('getDayNames', () => {
  it('tiếng Việt: 2=Thứ Hai, 8=Chủ Nhật', () => {
    const names = getDayNames('vi');
    expect(names[2]).toBe('Thứ Hai');
    expect(names[8]).toBe('Chủ Nhật');
  });
  it('tiếng Anh: 2=Monday, 8=Sunday', () => {
    const names = getDayNames('en');
    expect(names[2]).toBe('Monday');
    expect(names[8]).toBe('Sunday');
  });
});

describe('isPastCloseDate - đã qua hạn chót theo giờ VN', () => {
  it('null/undefined thì chưa qua hạn', () => {
    expect(isPastCloseDate(null)).toBe(false);
    expect(isPastCloseDate(undefined)).toBe(false);
  });
  it('ngày hôm qua theo giờ VN là đã qua hạn', () => {
    const y = new Date(Date.now() - 24 * 3600_000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(isPastCloseDate(y)).toBe(true);
  });
  it('hôm nay và ngày mai chưa qua hạn', () => {
    const t = todayVN();
    const tm = new Date(Date.now() + 24 * 3600_000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(isPastCloseDate(t)).toBe(false);
    expect(isPastCloseDate(tm)).toBe(false);
  });
});

describe('remainingOf', () => {
  it('amount − paid, paid thiếu/null = 0', () => {
    expect(remainingOf({ amount: 2_000_000, paid: 500_000 })).toBe(1_500_000);
    expect(remainingOf({ amount: 2_000_000 })).toBe(2_000_000);
    expect(remainingOf({ amount: 2_000_000, paid: null })).toBe(2_000_000);
  });
});
