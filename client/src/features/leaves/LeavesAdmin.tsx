import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { leavesApi, MakeupSuggestion } from './leaves.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { LeaveRequest, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './LeavesAdmin.css';

export function LeavesAdmin() {
  const { t } = useTranslation(['ops', 'common']);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState<LeaveRequest | null>(null);
  const [suggestions, setSuggestions] = useState<MakeupSuggestion[] | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leavesApi.list(status, { page });
      setLeaves(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leaves.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (l: LeaveRequest) => {
    try {
      const r = await leavesApi.approve(l.id);
      setSuggestions(r.suggestions);
      setApproving(l);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leaves.toast.approveFail'), 'error');
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    try {
      await leavesApi.reject(rejecting.id);
      toast(t('leaves.toast.rejected'), 'success');
      setRejecting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leaves.toast.rejectFail'), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('leaves.title')} desc={t('leaves.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t('leaves.filterLabel')}
        >
          <option value="">{t('leaves.allStatuses')}</option>
          <option value="pending">{t('leaves.status.pending')}</option>
          <option value="approved">{t('leaves.status.approved')}</option>
          <option value="rejected">{t('leaves.status.rejected')}</option>
        </select>
        {pagination && (
          <span className="toolbar-summary">
            {t('leaves.totalCount', { total: pagination.total, count: pagination.total })}
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton cols={6} />
      ) : leaves.length === 0 ? (
        <EmptyState icon="calendar-x" title={t('leaves.empty.title')} desc={t('leaves.empty.desc')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('leaves.col.student')}</th>
                <th>{t('leaves.col.fromDate')}</th>
                <th>{t('leaves.col.toDate')}</th>
                <th>{t('leaves.col.reason')}</th>
                <th>{t('leaves.col.status')}</th>
                <th className="th-right">{t('leaves.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="leave-student">{l.student_name}</span>
                    <span className="leave-code mono">({l.student_code})</span>
                    <div className="muted">{l.class_name || '-'}</div>
                  </td>
                  <td className="nowrap">{formatDate(l.from_date)}</td>
                  <td className="nowrap">{formatDate(l.to_date)}</td>
                  <td className="leave-reason" title={l.reason || undefined}>
                    {l.reason || '-'}
                  </td>
                  <td>
                    <span className={`badge badge-${l.status}`}>{t(`leaves.status.${l.status}`)}</span>
                  </td>
                  <td className="td-right">
                    {l.status === 'pending' && (
                      <span className="leave-actions">
                        <button className="btn btn-sm btn-primary" onClick={() => void approve(l)}>
                          <Icon name="check" size={14} />
                          {t('leaves.approve')}
                        </button>
                        <button className="btn btn-sm btn-danger-ghost" onClick={() => setRejecting(l)}>
                          <Icon name="x" size={14} />
                          {t('leaves.reject')}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {approving && (
        <Modal
          title={t('leaves.approvedTitle', { name: approving.student_name })}
          onClose={() => setApproving(null)}
        >
          <p className="confirm-text">{t('leaves.makeupHint')}</p>
          {suggestions && suggestions.length > 0 ? (
            <ul className="makeup-list">
              {suggestions.map((s) => (
                <li key={s.session_id} className="makeup-item">
                  <Icon name="calendar" size={16} />
                  <div>
                    <strong>{formatDate(s.date)}</strong>
                    {s.topic && <span className="muted"> · {s.topic}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('leaves.noMakeup')}</p>
          )}
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setApproving(null)}>
              {t('actions.close', { ns: 'common' })}
            </button>
          </div>
        </Modal>
      )}
      {rejecting && (
        <ConfirmDialog
          title={t('leaves.rejectDialog.title')}
          message={t('leaves.rejectDialog.message', {
            name: rejecting.student_name,
            from: formatDate(rejecting.from_date),
            to: formatDate(rejecting.to_date),
          })}
          onClose={() => setRejecting(null)}
          onConfirm={reject}
          danger
        />
      )}
    </div>
  );
}
