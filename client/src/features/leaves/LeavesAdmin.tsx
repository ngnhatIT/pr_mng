import { useCallback, useEffect, useState } from 'react';
import { leavesApi, MakeupSuggestion } from './leaves.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { LeaveRequest, LEAVE_STATUS_LABEL, labelOf, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './LeavesAdmin.css';

export function LeavesAdmin() {
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
      toast(err instanceof Error ? err.message : 'Không tải được đơn nghỉ phép', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

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
      toast(err instanceof Error ? err.message : 'Duyệt thất bại', 'error');
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    try {
      await leavesApi.reject(rejecting.id);
      toast('Đã từ chối đơn nghỉ phép', 'success');
      setRejecting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Quản lý đơn nghỉ phép" desc="Duyệt đơn xin nghỉ phép của học viên" />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Lọc theo trạng thái đơn"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="pending">Chờ duyệt</option>
          <option value="approved">Đã duyệt</option>
          <option value="rejected">Từ chối</option>
        </select>
        {pagination && (
          <span className="toolbar-summary">
            Tổng <strong>{pagination.total}</strong> đơn
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton cols={6} />
      ) : leaves.length === 0 ? (
        <EmptyState
          icon="calendar-x"
          title="Không có đơn nghỉ phép nào"
          desc="Chưa có đơn xin nghỉ phép nào cần xử lý."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Từ ngày</th>
                <th>Đến ngày</th>
                <th>Lý do</th>
                <th>Trạng thái</th>
                <th className="th-right">Thao tác</th>
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
                    <span className={`badge badge-${l.status}`}>{labelOf(LEAVE_STATUS_LABEL, l.status)}</span>
                  </td>
                  <td className="td-right">
                    {l.status === 'pending' && (
                      <span className="leave-actions">
                        <button className="btn btn-sm btn-primary" onClick={() => void approve(l)}>
                          <Icon name="check" size={14} />
                          Duyệt
                        </button>
                        <button className="btn btn-sm btn-danger-ghost" onClick={() => setRejecting(l)}>
                          <Icon name="x" size={14} />
                          Từ chối
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
        <Modal title={`Đã duyệt đơn - ${approving.student_name}`} onClose={() => setApproving(null)}>
          <p className="confirm-text">Gợi ý các buổi học bù phù hợp:</p>
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
            <p className="muted">Không có buổi học bù nào phù hợp.</p>
          )}
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setApproving(null)}>
              Đóng
            </button>
          </div>
        </Modal>
      )}
      {rejecting && (
        <ConfirmDialog
          title="Từ chối đơn nghỉ phép"
          message={`Từ chối đơn nghỉ phép của "${rejecting.student_name}" (${formatDate(rejecting.from_date)} đến ${formatDate(rejecting.to_date)})?`}
          onClose={() => setRejecting(null)}
          onConfirm={reject}
          danger
        />
      )}
    </div>
  );
}
