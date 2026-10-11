import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { auditApi } from './audit.api';
import { formatDateTime } from '../../shared/types';
import './SystemAdmin.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

const ACTIONS = [
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'payment',
  'apply_credit',
  'login',
] as const;
const ENTITIES = ['invoices', 'payments', 'students', 'teachers', 'classes'] as const;

function actionBadge(action: string): string {
  switch (action) {
    case 'delete':
    case 'reject':
      return 'badge-danger';
    case 'payment':
    case 'approve':
    case 'apply_credit':
      return 'badge-present';
    default:
      return 'badge-pending';
  }
}

export function AuditLogs() {
  const { t } = useTranslation(['ops', 'common']);
  const [q, setQ] = useUrlState({ action: '', entity: '', page: '1' });
  const { action, entity } = q;
  const page = Number(q.page) || 1;
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(
    () => auditApi.list({ action, entity }, { page }),
    [action, entity, page]
  );
  const logs = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới
  useEffect(() => {
    if (error) toastApiError(toast, error, t('audit.toast.loadFail'));
  }, [error, toast, t]);

  return (
    <div className="page">
      <PageHeader title={t('audit.title')} desc={t('audit.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={action}
          onChange={(e) => setQ({ action: e.target.value, page: '1' })}
          aria-label={t('audit.filterAction')}
        >
          <option value="">{t('audit.allActions')}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`audit.action.${a}`)}
            </option>
          ))}
        </select>
        <select
          className="text-input"
          value={entity}
          onChange={(e) => setQ({ entity: e.target.value, page: '1' })}
          aria-label={t('audit.filterEntity')}
        >
          <option value="">{t('audit.allEntities')}</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {t(`audit.entity.${e}`)}
            </option>
          ))}
        </select>
        {pagination && (
          <span className="audit-summary">
            {t('audit.totalCount', { total: pagination.total, count: pagination.total })}
          </span>
        )}
      </div>

      {loading && !data ? (
        <TableSkeleton cols={5} />
      ) : error && !data ? (
        <LoadError onRetry={reload} />
      ) : logs.length === 0 ? (
        <EmptyState icon="shield" title={t('audit.empty.title')} desc={t('audit.empty.desc')} />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('audit.col.time')}</th>
                <th scope="col">{t('audit.col.actor')}</th>
                <th scope="col">{t('audit.col.action')}</th>
                <th scope="col">{t('audit.col.detail')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono nowrap">{formatDateTime(l.created_at)}</td>
                  <td>
                    <span className="audit-actor">{l.actor_name || <EmptyCell />}</span>
                    {l.actor_role && <span className="muted"> ({l.actor_role})</span>}
                  </td>
                  <td>
                    <span className={`badge ${actionBadge(l.action)}`}>
                      {t(`audit.action.${l.action}`, { defaultValue: l.action })}
                    </span>
                  </td>
                  <td className="audit-detail" title={l.summary}>
                    {l.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
      )}
    </div>
  );
}
