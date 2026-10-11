import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { peopleApi } from './people.api';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { useLoad } from '../../shared/hooks/useLoad';
import { Modal } from '../../shared/components/Modal';
import { Field, MoneyInput, moneyDigits, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { PayrollRow, formatVND, todayVN } from '../../shared/types';
import { useMyPermissions } from '../system/roles.api';
import './Payroll.css';

export function Payroll() {
  const { t } = useTranslation(['people', 'common']);
  const [month, setMonth] = useState(() => todayVN().slice(0, 7));
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const toast = useToast();
  const canManage = useMyPermissions().has('payroll.manage');

  // UX-5: đổi tháng nhanh thì response tháng cũ về muộn bị bỏ qua; lỗi tải hiện LoadError thay vì "trống"
  const { data, loading, error, reload: load } = useLoad(() => peopleApi.payroll(month), [month]);
  const rows: PayrollRow[] = data ?? [];
  useEffect(() => {
    if (error) toastApiError(toast, error, t('payroll.loadError'));
  }, [error, toast]);

  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="page">
      <PageHeader
        title={t('payroll.title')}
        desc={t('payroll.desc')}
        actions={
          // B5-5: tải lỗi -> không hiện "Tổng chi 0đ" (hoặc tổng của tháng cũ) phía trên LoadError
          !error &&
          data && (
            <span className="payroll-total">
              <Icon name="banknote" size={16} />
              {t('payroll.totalSpent')}
              <strong className="debt-amount">{formatVND(total)}</strong>
            </span>
          )
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

      {loading && !data ? (
        <TableSkeleton cols={5} />
      ) : error && !data ? (
        <LoadError onRetry={load} />
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
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table table-stack">
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
                  <td data-label={t('payroll.table.sessions')} className="num">
                    {r.sessions}
                  </td>
                  <td data-label={t('payroll.table.perSession')} className="num">
                    {formatVND(r.per_session)}
                    {r.mixed_rates && (
                      <div className="muted-xs">
                        {t('payroll.mixedRate', { avg: formatVND(r.avg_rate ?? 0) })}
                      </div>
                    )}
                  </td>
                  <td data-label={t('payroll.table.total')} className="num">
                    <strong>{formatVND(r.total)}</strong>
                  </td>
                  <td className="td-right">
                    {canManage && (
                      <span className="row-actions">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(r)}>
                          <Icon name="pencil" size={15} />
                          {t('payroll.rate')}
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

      {editing && (
        <RateModal
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RateModal({ row, onClose, onDone }: { row: PayrollRow; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['people', 'common']);
  const [initial] = useState(() => moneyDigits(row.per_session));
  const [amount, setAmount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'amount'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    const errs: { amount?: string } = {};
    if (!amount || !Number.isFinite(amt) || amt < 0) errs.amount = t('rate.errors.amountInvalid');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await peopleApi.savePayRule(row.teacher_id, Number(amount));
      toast(t('rate.updated', { name: row.teacher_name }), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('rate.updateError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('rate.title', { name: row.teacher_name })} onClose={onClose} dirty={amount !== initial}>
      <form onSubmit={submit}>
        <Field label={t('rate.unit')} error={errors.amount}>
          <MoneyInput
            ref={refFor('amount')}
            className="text-input"
            value={amount}
            onChange={(v) => {
              setAmount(v);
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
