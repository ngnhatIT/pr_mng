import { useEffect } from 'react';

/**
 * useDocumentTitle: đặt tiêu đề tab cho trang public, hoặc trang trong layout không có mục menu (404, chi tiết con).
 * Các layout đặt title theo route bằng useLayoutEffect (chạy trước effect này) nên trang con luôn thắng.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} - EduCenter Pro` : 'EduCenter Pro';
  }, [title]);
}
