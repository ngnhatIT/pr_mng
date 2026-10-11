import { useEffect } from 'react';

// Số form đang có thay đổi chưa lưu (Modal dirty, Attendance, Roles...). Đọc lúc điều hướng bởi
// <UnsavedChangesPrompt> (app/App.tsx) - MỘT useBlocker cho cả app, vì router chỉ dùng blocker đăng ký sau cùng.
let dirtyCount = 0;

/** Có form nào đang giữ thay đổi chưa lưu không (dùng trong blocker điều hướng). */
export function hasUnsavedChanges(): boolean {
  return dirtyCount > 0;
}

/**
 * UX-4: khi `dirty` = true:
 * - reload / đóng tab / gõ URL khác: trình duyệt hỏi xác nhận (beforeunload);
 * - bấm link trong app / Back: hiện ConfirmDialog "Bỏ thay đổi chưa lưu?" (common:discard.*) qua useBlocker.
 * Dùng cho form cả trang (Attendance, Roles, PaymentConfig...). Modal có prop `dirty` đã tự gọi hook này.
 * Không cần router: ngoài data router (test) chỉ còn phần beforeunload.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyCount++;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Safari/Chrome cũ cần returnValue
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      dirtyCount--;
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);
}
