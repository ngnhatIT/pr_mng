import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { LeaveRequest, ParentChild, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentLeaves() {
  const { t } = useTranslation(['parent', 'common']);
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
      toast(err instanceof Error ? err.message : t('leaves.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="parent-page">
      <div className="page-head">
        <h1 className="parent-title">{t('leaves.title')}</h1>
        <button className="btn btn-primary btn-sm create-leave-btn" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={15} />
          {t('leaves.create')}
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
        <EmptyState icon="calendar-x" title={t('leaves.emptyTitle')} desc={t('leaves.emptyDesc')} />
      ) : (
        <div className="leave-list">
          {leaves.map((l) => (
            <div key={l.id} className="card leave-card">
              <div className="leave-card-head">
                <strong>
                  {l.student_name} <span className="muted">· {l.class_name || '-'}</span>
                </strong>
                <span className={`badge badge-${l.status}`}>{t(`status.leave.${l.status}`)}</span>
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
  const { t } = useTranslation(['parent', 'common']);
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
      toast(t('leaves.childRequired'), 'error');
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
      toast(t('leaves.sent'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leaves.sendError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('leaves.formTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('leaves.child')} span>
            <select
              className="text-input"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setClassId('');
              }}
              required
            >
              <option value="">{t('leaves.selectChild')}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('leaves.class')} span>
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{t('leaves.allClasses')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('leaves.fromDate')}>
            <input
              className="text-input"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </Field>
          <Field label={t('leaves.toDate')}>
            <input
              className="text-input"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </Field>
          <Field label={t('leaves.reason')} span>
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
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('actions.sending', { ns: 'common' }) : t('leaves.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
