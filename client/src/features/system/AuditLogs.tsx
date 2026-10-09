import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { auditApi, ACTION_LABEL, ENTITY_LABEL, type AuditLog } from './audit.api';
import { formatDateTime } from '../../shared/types';
import './SystemAdmin.css';

const ACTIONS = Object.keys(ACTION_LABEL);
const ENTITIES = Object.keys(ENTITY_LABEL);

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
      toast(err instanceof Error ? err.message : 'Không tải được nhật ký', 'error');
    } finally {
      setLoading(false);
    }
  }, [action, entity, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        title="Nhật ký hoạt động"
        desc="Ai đã làm gì - đặc biệt các thao tác tiền bạc và xóa dữ liệu"
      />

      <div className="toolbar">
        <select
          className="text-input"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label="Lọc theo hành động"
        >
          <option value="">Tất cả hành động</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
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
          aria-label="Lọc theo đối tượng"
        >
          <option value="">Tất cả đối tượng</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABEL[e]}
            </option>
          ))}
        </select>
        {pagination && (
          <span className="audit-summary">
            Tổng <strong>{pagination.total}</strong> dòng nhật ký
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon="shield"
          title="Chưa có nhật ký nào"
          desc="Các thao tác quan trọng (thu tiền, duyệt thanh toán, xóa dữ liệu) sẽ được ghi lại ở đây."
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người thực hiện</th>
                <th>Hành động</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono nowrap">{formatDateTime(l.created_at)}</td>
                  <td>
                    <span className="audit-actor">{l.actor_name || '-'}</span>
                    {l.actor_role && <span className="muted"> ({l.actor_role})</span>}
                  </td>
                  <td>
                    <span className={`badge ${actionBadge(l.action)}`}>
                      {ACTION_LABEL[l.action] || l.action}
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
