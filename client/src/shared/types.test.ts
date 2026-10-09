import { describe, it, expect } from 'vitest';
import { formatVND, formatDate, formatDateTime, formatScheduleText } from './types';

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
