import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
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
        <EmptyState
          icon="calendar-x"
          title={t('leaves.emptyTitle')}
          desc={t('leaves.emptyDesc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={15} />
              {t('leaves.create')}
            </button>
          }
        />
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
  const [submitError, setSubmitError] = useState('');
  const { errors, refFor, show, clear } = useFieldErrors<'child' | 'fromDate' | 'toDate'>();
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
    if (busy) return;
    // Lỗi form hiện inline dưới field, focus vào field đầu tiên (skill 8.2)
    const errs: { child?: string; fromDate?: string; toDate?: string } = {};
    if (!studentId) errs.child = t('leaves.childRequired');
    if (!fromDate) errs.fromDate = t('leaves.fromRequired');
    if (!toDate) errs.toDate = t('leaves.toRequired');
    else if (fromDate && toDate < fromDate) errs.toDate = t('leaves.dateRangeInvalid');
    if (!show(errs)) return;
    setBusy(true);
    setSubmitError(''); // dữ liệu giữ nguyên, lỗi hiện ngay dưới nút gửi
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
      setSubmitError(err instanceof Error ? err.message : t('leaves.sendError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('leaves.formTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label={t('leaves.child')} error={errors.child} span required>
            <select
              className="text-input"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setClassId('');
                clear('child');
              }}
              ref={refFor('child')}
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
          <Field label={t('leaves.fromDate')} error={errors.fromDate} required>
            <input
              className="text-input"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                clear('fromDate');
              }}
              ref={refFor('fromDate')}
            />
          </Field>
          <Field label={t('leaves.toDate')} error={errors.toDate} required>
            <input
              className="text-input"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                clear('toDate');
              }}
              ref={refFor('toDate')}
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
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.sending', { ns: 'common' }) : t('leaves.submit')}
          </button>
        </div>
        {submitError && (
          <p className="field-error" role="alert" style={{ marginTop: 8 }}>
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}
