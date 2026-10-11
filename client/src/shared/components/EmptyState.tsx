import { ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from './icons';

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: IconName;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  // B6-7: icon "alert" = trạng thái lỗi (tải lỗi / không tìm thấy) -> role=alert để screen reader đọc ngay
  return (
    <div className="empty-state" role={icon === 'alert' ? 'alert' : undefined}>
      <div className="empty-state-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="empty-state-title">{title}</div>
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/**
 * UX-5: trạng thái tải lỗi (khác "chưa có dữ liệu"): không hiện "Thêm X đầu tiên" khi thực ra là lỗi mạng.
 * Dùng với useLoad: `error && !data ? <LoadError onRetry={reload} /> : ...`
 */
export function LoadError({ onRetry, title }: { onRetry: () => void; title?: string }) {
  const { t } = useTranslation('common');
  // B6-3: bấm "Thử lại" -> LoadError (cùng nút đang focus) biến mất; đưa focus về vùng nội dung thay vì rơi về <body>
  const retried = useRef(false);
  useEffect(
    () => () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (retried.current && lost) document.getElementById('main-content')?.focus({ preventScroll: true });
    },
    []
  );
  return (
    <EmptyState
      icon="alert"
      title={title ?? t('states.loadError')}
      action={
        <button
          type="button"
          className="btn"
          onClick={() => {
            retried.current = true;
            onRetry();
          }}
        >
          {t('actions.retry')}
        </button>
      }
    />
  );
}
