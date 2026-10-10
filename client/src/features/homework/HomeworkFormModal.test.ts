import { describe, it, expect } from 'vitest';
import { isValidHttpUrl } from './HomeworkFormModal';

describe('isValidHttpUrl', () => {
  it('chấp nhận http/https', () => {
    expect(isValidHttpUrl('https://drive.google.com/x')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });
  it('từ chối protocol khác và chuỗi rác', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('không phải url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});
