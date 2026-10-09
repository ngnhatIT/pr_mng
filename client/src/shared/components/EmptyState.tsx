import { ReactNode } from 'react';
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
