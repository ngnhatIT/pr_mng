import { ReactNode } from 'react';
import { Icon, IconName } from './icons';

export function StatCard({
  icon,
  value,
  label,
  sub,
  tone = 'blue',
}: {
  icon: IconName;
  value: ReactNode;
  label: string;
  sub?: string;
  tone?: 'blue' | 'green' | 'violet' | 'amber';
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <div className="stat-label">{label}</div>
        <div className={`stat-icon`}>
          <Icon name={icon} size={20} />
        </div>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
