import { Component, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Tên tầng để log (ví dụ 'root', 'app', 'parent', 'teacher'). */
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Fallback UI đẹp khi một subtree React crash. */
function ErrorFallback({ onRetry }: { name?: string; onRetry: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="error-fallback" role="alert">
      <div className="error-fallback-card">
        <div className="error-fallback-icon">
          <Icon name="alert" size={28} />
        </div>
        <h2>{t('error.title')}</h2>
        <p>{t('error.message')}</p>
        <div className="error-fallback-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="rotate" size={16} />
            <span>{t('error.retry')}</span>
          </button>
          <a href="/" className="btn">
            {t('error.home')}
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * ErrorBoundary 3 tầng: bọc root App + từng layout route (/app, /parent, /teacher).
 * Crash 1 trang không còn trắng toàn app. Log lỗi về console + best-effort gửi server.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const label = this.props.name ?? 'app';
    // Cố ý dùng console: đây là log lỗi crash duy nhất phía client (no-console cấm log debug thường).
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${label}]`, error, info.componentStack);
    try {
      void fetch('/api/v1/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: label,
          message: error.message,
          stack: error.stack?.slice(0, 2000),
          url: window.location.href,
        }),
      }).catch(() => {
        /* bỏ qua: log best-effort */
      });
    } catch {
      /* bỏ qua */
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback name={this.props.name} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
