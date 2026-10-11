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
  requestId?: string;
}

/** Fallback UI đẹp khi một subtree React crash. */
function ErrorFallback({ onRetry, requestId }: { name?: string; onRetry: () => void; requestId?: string }) {
  const { t } = useTranslation('common');
  return (
    <div className="error-fallback" role="alert">
      <div className="error-fallback-card">
        <div className="error-fallback-icon">
          <Icon name="alert" size={28} />
        </div>
        <h2>{t('error.title')}</h2>
        <p>{t('error.message')}</p>
        {requestId && (
          <p className="error-fallback-code">
            {t('errorCode')}: {requestId}
          </p>
        )}
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

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i;
const CHUNK_RELOAD_KEY = 'edu_chunk_reload';

/**
 * FE-2: lỗi tải chunk lazy (thường do vừa deploy, hash cũ không còn) -> React.lazy cache promise lỗi nên
 * Retry vô ích. Reload trang 1 lần để lấy index.html + chunk mới. Guard bằng sessionStorage (timestamp)
 * để không reload lặp vô hạn nếu server thực sự hỏng. Trả true nếu đã kích hoạt reload.
 */
export function reloadOnceOnChunkError(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  reload: () => void = () => window.location.reload(),
  now = Date.now()
): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (!CHUNK_ERROR_RE.test(msg)) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (now - last < 60_000) return false; // vừa reload xong mà vẫn lỗi -> hiện fallback
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * ErrorBoundary nhiều tầng: bọc root App + từng layout route (/app, /parent, /teacher) + từng trang (PageOutlet).
 * Crash 1 trang không còn trắng toàn app. Log lỗi về console + best-effort gửi server.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    if (reloadOnceOnChunkError(error)) return;
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
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.request_id) this.setState({ requestId: data.request_id });
        })
        .catch(() => {
          /* bỏ qua: log best-effort */
        });
    } catch {
      /* bỏ qua */
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, requestId: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallback name={this.props.name} onRetry={this.handleRetry} requestId={this.state.requestId} />
      );
    }
    return this.props.children;
  }
}
