import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { peopleApi } from './people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { PayrollRow, formatVND } from '../../shared/types';
import './Payroll.css';

export function Payroll() {
  const { t } = useTranslation(['people', 'common']);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await peopleApi.payroll(month);
      setRows(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('payroll.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="page">
      <PageHeader
        title={t('payroll.title')}
        desc={t('payroll.desc')}
        actions={
          <span className="payroll-total">
            <Icon name="banknote" size={16} />
            {t('payroll.totalSpent')}
            <strong className="debt-amount">{formatVND(total)}</strong>
          </span>
        }
      />

      <div className="toolbar">
        <Field label={t('payroll.month')}>
          <input
            className="text-input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="banknote"
          title={t('payroll.emptyTitle')}
          desc={t('payroll.emptyDesc')}
          action={
            <Link className="btn btn-primary btn-inline" to="/app/attendance">
              <Icon name="check" size={14} />
              {t('payroll.viewAttendance')}
            </Link>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('payroll.table.teacher')}</th>
                <th scope="col">{t('payroll.table.sessions')}</th>
                <th scope="col">{t('payroll.table.perSession')}</th>
                <th scope="col">{t('payroll.table.total')}</th>
                <th scope="col" className="th-right">
                  {t('payroll.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacher_id}>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        <Icon name="user" size={15} />
                      </span>
                      {r.teacher_name}
                    </span>
                  </td>
                  <td className="num">{r.sessions}</td>
                  <td className="num">{formatVND(r.per_session)}</td>
                  <td className="num">
                    <strong>{formatVND(r.total)}</strong>
                  </td>
                  <td className="td-right">
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('payroll.rate')}
                        aria-label={t('payroll.rate')}
                        onClick={() => setEditing(r)}
                      >
                        <Icon name="pencil" size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RateModal
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function RateModal({ row, onClose, onDone }: { row: PayrollRow; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['people', 'common']);
  const [amount, setAmount] = useState(String(row.per_session));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'amount'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    const errs: { amount?: string } = {};
    if (!amount.trim() || !Number.isFinite(amt) || amt < 0) errs.amount = t('rate.errors.amountInvalid');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await peopleApi.savePayRule(row.teacher_id, Number(amount));
      toast(t('rate.updated', { name: row.teacher_name }), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('rate.updateError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('rate.title', { name: row.teacher_name })} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={t('rate.unit')} error={errors.amount}>
          <input
            ref={refFor('amount')}
            className="text-input"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              clear('amount');
            }}
          />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
