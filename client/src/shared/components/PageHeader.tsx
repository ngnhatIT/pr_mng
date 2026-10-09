import { ReactNode } from 'react';

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-sub">{desc}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
