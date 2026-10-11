import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * useDocumentTitle: đặt tiêu đề tab cho trang public, hoặc trang trong layout không có mục menu (404, chi tiết con).
 * Các layout đặt title theo route bằng useLayoutEffect (chạy trước effect này) nên trang con luôn thắng.
 * B5-2: layout đặt lại title khi đổi ngôn ngữ -> chạy lại cả khi đổi ngôn ngữ (dù title không đổi, vd tên học viên).
 */
export function useDocumentTitle(title: string): void {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.title = title ? `${title} - EduCenter Pro` : 'EduCenter Pro';
  }, [title, i18n.language]);
}
