import { useCallback, useEffect, useState } from 'react';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { LeaveRequest, ParentChild, LEAVE_STATUS_LABEL, labelOf, formatDate } from '../../shared/types';

export function ParentLeaves() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await parentApi.leaves();
      setLeaves(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được đơn nghỉ phép', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="parent-page">
      <div className="page-head">
        <h1 className="parent-title">Xin nghỉ phép</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
          + Tạo đơn mới
        </button>
      </div>

      {loading ? (
        <div className="leave-list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <Skeleton width="60%" height={18} radius={8} />
              <div style={{ marginTop: 10 }}>
                <Skeleton width="40%" height={13} />
              </div>
            </div>
          ))}
        </div>
      ) : leaves.length === 0 ? (
        <EmptyState
          icon="calendar-x"
          title="Chưa có đơn nghỉ phép nào"
          desc="Nhấn “+ Tạo đơn mới” để gửi đơn xin nghỉ phép cho con."
        />
      ) : (
        <div className="leave-list">
          {leaves.map((l) => (
            <div key={l.id} className="card leave-card">
              <div className="leave-card-head">
                <strong>
                  {l.student_name} <span className="muted">· {l.class_name || '—'}</span>
                </strong>
                <span className={`badge badge-${l.status}`}>{labelOf(LEAVE_STATUS_LABEL, l.status)}</span>
              </div>
              <div className="muted">
                {formatDate(l.from_date)} → {formatDate(l.to_date)}
              </div>
              {l.reason && <p className="leave-reason">{l.reason}</p>}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <LeaveFormModal
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function LeaveFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    parentApi
      .children()
      .then(setChildren)
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const student = children.find((c) => String(c.id) === studentId);
  const classes = student?.classes || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId) {
      toast('Vui lòng chọn con', 'error');
      return;
    }
    setBusy(true);
    try {
      await parentApi.createLeave({
        student_id: Number(studentId),
        class_id: classId ? Number(classId) : null,
        from_date: fromDate,
        to_date: toDate,
        reason: reason || null,
      });
      toast('Đã gửi đơn xin nghỉ phép', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tạo đơn xin nghỉ phép" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Con *" span>
            <select
              className="text-input"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setClassId('');
              }}
              required
            >
              <option value="">— Chọn con —</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lớp" span>
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— Tất cả các lớp —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Từ ngày *">
            <input
              className="text-input"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Đến ngày *">
            <input
              className="text-input"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Lý do" span>
            <textarea
              className="text-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang gửi...' : 'Gửi đơn'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
