import { ReactNode } from 'react';
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
  return (
    <div className="empty-state">
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
  return (
    <div role="alert">
      <EmptyState
        icon="alert"
        title={title ?? t('states.loadError')}
        action={
          <button type="button" className="btn" onClick={onRetry}>
            {t('actions.retry')}
          </button>
        }
      />
    </div>
  );
}
