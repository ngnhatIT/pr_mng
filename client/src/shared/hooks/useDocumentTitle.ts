import { useEffect } from 'react';

/**
 * useDocumentTitle: đặt tiêu đề tab cho trang public (không nằm trong layout).
 * Các layout (staff/parent/teacher) đã tự đặt title theo route.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} - EduCenter Pro` : 'EduCenter Pro';
  }, [title]);
}
