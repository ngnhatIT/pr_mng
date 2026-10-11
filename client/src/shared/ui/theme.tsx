import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

// Khóa mới: bản cũ tự ghi theme lúc mount nên mọi người dùng cũ đều có giá trị -> không phân biệt được lựa chọn tay
const KEY = 'educenter-theme-choice';

const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

function detectTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* bỏ qua */
  }
  return 'light';
}

const hasExplicit = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark';
  } catch {
    return false;
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(detectTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Chưa tự chọn -> đi theo hệ điều hành, kể cả khi OS đổi sáng/tối lúc đang mở app
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => !hasExplicit() && setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Chỉ lưu khi người dùng bấm (không đóng băng lựa chọn OS ngay lần đầu vào)
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* bỏ qua */
      }
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
