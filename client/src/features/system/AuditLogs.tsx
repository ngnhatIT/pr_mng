import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { auditApi, type AuditLog } from './audit.api';
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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditApi.list({ action, entity }, { page });
      setLogs(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('audit.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [action, entity, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader title={t('audit.title')} desc={t('audit.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
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
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
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

      {loading ? (
        <TableSkeleton cols={5} />
      ) : logs.length === 0 ? (
        <EmptyState icon="shield" title={t('audit.empty.title')} desc={t('audit.empty.desc')} />
      ) : (
        <div className="table-wrap sticky">
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

      {pagination && <Pagination pagination={pagination} onChange={setPage} />}
    </div>
  );
}
