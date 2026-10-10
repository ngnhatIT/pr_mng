import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { Icon } from '../../shared/components/icons';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast(): (message: string, type?: ToastType) => void {
  return useContext(ToastContext);
}

/**
 * Toast lỗi từ Error API: tự gắn mã lỗi (request_id) để user báo support.
 * Dùng thay cho toast(err.message, 'error') ở các catch.
 */
export function toastApiError(
  toast: (message: string, type?: ToastType) => void,
  err: unknown,
  fallback: string
): void {
  const e = err as (Error & { requestId?: string; code?: string }) | undefined;
  // Ưu tiên thông điệp theo mã lỗi (đa ngôn ngữ); chưa có key thì giữ message gốc của server
  const codeKey = e?.code ? `api.errors.${e.code}` : '';
  const msg =
    codeKey && i18n.exists(codeKey, { ns: 'common' })
      ? String(i18n.t(codeKey, { ns: 'common' }))
      : e instanceof Error
        ? e.message
        : fallback;
  const suffix = e?.requestId ? ` (${i18n.t('errorCode', { ns: 'common' })}: ${e.requestId})` : '';
  toast(`${msg}${suffix}`, 'error');
}

let nextId = 1;

const TOAST_ICON = {
  success: 'check-circle',
  error: 'alert',
  info: 'info',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const { t } = useTranslation('common');

  const push = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Toast lỗi ở lại lâu hơn để user kịp đọc
    window.setTimeout(
      () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      type === 'error' ? 6000 : 3200
    );
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.type}`} role="status">
            <span className="toast-icon">
              <Icon name={TOAST_ICON[item.type]} size={18} />
            </span>
            <span className="toast-msg">{item.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(item.id)}
              aria-label={t('actions.close')}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
