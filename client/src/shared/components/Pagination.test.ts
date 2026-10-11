import { describe, it, expect } from 'vitest';
import { clampPage, fetchAllPages } from './Pagination';

describe('clampPage - kéo trang về trong [1, totalPages] (ADM-13)', () => {
  it('xoá dòng cuối của trang 2 -> còn 1 trang -> về trang 1', () => {
    expect(clampPage(2, 1)).toBe(1);
  });
  it('danh sách rỗng (totalPages 0) -> trang 1', () => {
    expect(clampPage(3, 0)).toBe(1);
  });
  it('trang hợp lệ giữ nguyên', () => {
    expect(clampPage(2, 5)).toBe(2);
  });
});

describe('fetchAllPages - gộp đủ mọi trang (ADM-6)', () => {
  it('tải trang 1 rồi các trang còn lại theo totalPages', async () => {
    const calls: number[] = [];
    const all = await fetchAllPages(async ({ page = 1, limit = 100 }) => {
      calls.push(page);
      return { data: [page * 10, page * 10 + 1], pagination: { page, limit, total: 6, totalPages: 3 } };
    });
    expect(all).toEqual([10, 11, 20, 21, 30, 31]);
    expect(calls.sort()).toEqual([1, 2, 3]);
  });
});
