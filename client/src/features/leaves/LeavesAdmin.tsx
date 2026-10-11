import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { leavesApi, MakeupSuggestion } from './leaves.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { LeaveRequest, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './LeavesAdmin.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

export function LeavesAdmin() {
  const { t } = useTranslation(['ops', 'common']);
  // UX-6: bộ lọc/trang trên URL
  const [q, setQ] = useUrlState({ status: '', page: '1' });
  const { status } = q;
  const page = Number(q.page) || 1;
  const [approving, setApproving] = useState<LeaveRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<MakeupSuggestion[] | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const toast = useToast();

  const {
    data,
    loading,
    error,
    reload: load,
  } = useLoad(() => leavesApi.list(status, { page }), [status, page]);
  const leaves: LeaveRequest[] = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  useEffect(() => {
    if (error) toastApiError(toast, error, t('leaves.toast.loadFail'));
  }, [error, toast, t]);
  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới

  const approve = async (l: LeaveRequest) => {
    // Chặn bấm trùng khi API đang chạy: nút hiện spinner + disabled
    if (busyId !== null) return;
    setBusyId(l.id);
    try {
      const r = await leavesApi.approve(l.id);
      setSuggestions(r.suggestions);
      setApproving(l);
      load();
    } catch (err) {
      toastApiError(toast, err, t('leaves.toast.approveFail'));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    try {
      await leavesApi.reject(rejecting.id);
      toast(t('leaves.toast.rejected'), 'success');
      setRejecting(null);
      load();
    } catch (err) {
      toastApiError(toast, err, t('leaves.toast.rejectFail'));
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('leaves.title')} desc={t('leaves.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => setQ({ status: e.target.value, page: '1' })}
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

      {loading && !data ? (
        <TableSkeleton cols={6} />
      ) : error && !data ? (
        <LoadError onRetry={load} />
      ) : leaves.length === 0 ? (
        <EmptyState icon="calendar-x" title={t('leaves.empty.title')} desc={t('leaves.empty.desc')} />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('leaves.col.student')}</th>
                <th scope="col">{t('leaves.col.fromDate')}</th>
                <th scope="col">{t('leaves.col.toDate')}</th>
                <th scope="col">{t('leaves.col.reason')}</th>
                <th scope="col">{t('leaves.col.status')}</th>
                <th scope="col" className="th-right">
                  {t('leaves.col.actions')}
                </th>
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
                    {l.reason || <EmptyCell />}
                  </td>
                  <td>
                    <span className={`badge badge-${l.status}`}>{t(`leaves.status.${l.status}`)}</span>
                  </td>
                  <td className="td-right">
                    {l.status === 'pending' && (
                      <span className="leave-actions">
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => void approve(l)}
                          disabled={busyId === l.id}
                        >
                          {busyId === l.id ? (
                            <span className="spinner" aria-hidden="true" />
                          ) : (
                            <Icon name="check" size={14} />
                          )}
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

      {pagination && (
        <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
      )}

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
