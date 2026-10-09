import { useEffect, useState } from 'react';

/**
 * useDebounce: trì hoãn giá trị search/filter để tránh gọi API liên tục khi gõ.
 * Dùng chung cho mọi trang có ô tìm kiếm (thay vì hand-roll setTimeout ở từng trang).
 */
export function useDebounce<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
