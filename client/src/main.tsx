import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { ToastProvider } from './shared/ui/toast';
import { ThemeProvider } from './shared/ui/theme';
import './i18n';
import './styles/styles.css';

/** Id của bản build (vite.config define) — đổi mỗi lần build để SW cài bản mới + dọn cache cũ. */
declare const __BUILD_ID__: string;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        {/* Router (data router RR7) + UnauthorizedListener nằm trong App */}
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);

// Đăng ký service worker cho PWA (chỉ production / khi có sw.js)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {
      /* bỏ qua nếu không đăng ký được */
    });
  });
}
