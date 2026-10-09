import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { ToastProvider } from './shared/ui/toast';
import { ThemeProvider } from './shared/ui/theme';
import { UnauthorizedListener } from './shared/api/UnauthorizedListener';
import './i18n';
import './styles/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <UnauthorizedListener />
          <App />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Đăng ký service worker cho PWA (chỉ production / khi có sw.js)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* bỏ qua nếu không đăng ký được */
    });
  });
}
