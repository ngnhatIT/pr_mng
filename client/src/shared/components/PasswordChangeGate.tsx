import { Suspense, lazy, useEffect, useReducer } from 'react';
import { useLocation } from 'react-router-dom';
import { PASSWORD_CHANGE_EVENT, getUser } from '../api/client';

// Lazy: gate nằm trong entry (Root) nhưng form chỉ cần khi bị bắt đổi mật khẩu -> không đội entry chunk.
const ChangePasswordModal = lazy(() =>
  import('./ChangePasswordModal').then((m) => ({ default: m.ChangePasswordModal }))
);

/** Khu vực cần đăng nhập (staff /app, /teacher; phụ huynh /parent trừ login/register). */
const PROTECTED = /^\/(app|teacher|parent)(\/|$)/;
const PUBLIC_PARENT = /^\/parent\/(login|register)(\/|$)/;

/**
 * Mở form đổi mật khẩu BẮT BUỘC khi user đăng nhập có must_change_password (từ login/refresh)
 * hoặc khi api() nhận 403 PASSWORD_CHANGE_REQUIRED. Đặt trong router (Root của App), dùng cho cả 2 cổng.
 */
export function PasswordChangeGate() {
  const { pathname } = useLocation();
  // Event từ api() đã cập nhật user lưu trữ -> chỉ cần render lại để đọc cờ mới.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(PASSWORD_CHANGE_EVENT, rerender);
    return () => window.removeEventListener(PASSWORD_CHANGE_EVENT, rerender);
  }, []);
  const required =
    PROTECTED.test(pathname) && !PUBLIC_PARENT.test(pathname) && !!getUser()?.must_change_password;
  return required ? (
    <Suspense fallback={null}>
      {/* Đổi xong: tải lại trang để các request đã bị 403 trước đó chạy lại với token mới */}
      <ChangePasswordModal forced onClose={() => window.location.reload()} />
    </Suspense>
  ) : null;
}
