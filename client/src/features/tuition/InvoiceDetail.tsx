import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoicesApi, paymentMethodLabel, type InvoiceDetailData, type PaymentItem } from './tuition.api';
import { useMyPermissions } from '../system/roles.api';
import { PayModal } from './Tuition';
import { useGoBack } from '../../shared/hooks/useGoBack';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton, TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyCell } from '../../shared/components/EmptyCell';
import { ReceiptModal } from '../../shared/components/ReceiptModal';
import { Icon } from '../../shared/components/icons';
import { formatVND, formatDate, formatDateTime, remainingOf } from '../../shared/types';
import './Tuition.css';
import { getUser } from '../../shared/api/client';

/** ADM-3: số đã thu = `paid` server trả; server cũ không trả thì cộng các thanh toán đã xác nhận
 * (dòng hoàn tiền là số âm nên tự trừ ra). */
export function paidOf(
  invoice: { paid?: number | null },
  payments: Pick<PaymentItem, 'amount' | 'status'>[]
): number {
  if (invoice.paid != null) return Number(invoice.paid);
  return payments.filter((p) => p.status === 'confirmed').reduce((sum, p) => sum + Number(p.amount), 0);
}

// Badge trạng thái thanh toán: reuse token semantic có sẵn (không thêm CSS mới).
const PAYMENT_STATUS_BADGE: Record<string, string> = {
  pending: 'badge-overdue',
  confirmed: 'badge-paid',
  rejected: 'badge-failed',
};

export function InvoiceDetail() {
  const { t } = useTranslation(['tuition', 'common']);
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<InvoiceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'notFound' | 'load' | null>(null);
  // Fail-closed: không kiểm tra được quyền thu tiền thì ẩn nút Thu tiền.
  const canCollect = useMyPermissions().has('payments.collect');
  const [showReceipt, setShowReceipt] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await invoicesApi.detail(Number(id)));
    } catch (err) {
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      setError(code === 'NOT_FOUND' ? 'notFound' : 'load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = useGoBack('/app/tuition');

  if (loading) {
    return (
      <div className="page">
        <Skeleton width={120} height={20} aria-hidden />
        <div style={{ marginTop: 8 }} aria-hidden>
          <Skeleton width={220} height={28} radius={8} />
        </div>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <Skeleton height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="80%" height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="60%" height={14} />
          </div>
        </section>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <TableSkeleton cols={5} rows={3} />
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <EmptyState
          icon="alert"
          title={t(`detail.${error === 'notFound' ? 'notFoundTitle' : 'loadErrorTitle'}`)}
          desc={t(`detail.${error === 'notFound' ? 'notFoundDesc' : 'loadErrorDesc'}`)}
          action={
            error === 'notFound' ? (
              <Link className="btn btn-primary btn-inline" to="/app/tuition">
                {t('detail.backToTuition')}
              </Link>
            ) : (
              <button type="button" className="btn btn-primary btn-inline" onClick={() => void load()}>
                <Icon name="rotate" size={14} />
                {t('detail.retry')}
              </button>
            )
          }
        />
      </div>
    );
  }

  const { payments } = data as InvoiceDetailData;
  const paid = paidOf(data!.invoice, payments);
  const invoice = { ...data!.invoice, paid };
  const remain = remainingOf(invoice);

  return (
    <div className="page">
      <button type="button" className="link back-link" onClick={goBack}>
        <Icon name="arrow-left" size={14} />
        {t('detail.back')}
      </button>
      <nav className="invoice-breadcrumb" aria-label={t('detail.breadcrumbLabel')}>
        <Link className="link" to="/app/tuition">
          {t('detail.breadcrumbTuition')}
        </Link>
        <span className="invoice-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('detail.breadcrumbInvoice', { id: invoice.id })}</span>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-title">{t('detail.title', { id: invoice.id })}</h1>
          <div className="profile-badges">
            <span className={`badge badge-${invoice.status}`}>{t(`invoiceStatus.${invoice.status}`)}</span>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setShowReceipt(true)}>
            <Icon name="printer" size={14} />
            {t('detail.printReceipt')}
          </button>
          {canCollect && remain > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => setPaying(true)}>
              <Icon name="banknote" size={14} />
              {t('detail.collect')}
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <div className="section-head">
          <h3>{t('detail.info')}</h3>
        </div>
        <dl className="kv">
          <dt>{t('detail.student')}</dt>
          <dd>
            <Link className="link" to={`/app/students/${invoice.student_id}`}>
              {invoice.student_name} <span className="muted mono">({invoice.student_code})</span>
            </Link>
          </dd>
          <dt>{t('detail.class')}</dt>
          <dd>
            {invoice.class_id && invoice.class_name ? (
              <Link className="link" to={`/app/classes/${invoice.class_id}`}>
                {invoice.class_name}
              </Link>
            ) : (
              <EmptyCell />
            )}
          </dd>
          <dt>{t('detail.amount')}</dt>
          <dd className="num">
            <strong>{formatVND(invoice.amount)}</strong>
          </dd>
          <dt>{t('detail.paid')}</dt>
          <dd className="num">{formatVND(paid)}</dd>
          <dt>{t('detail.remain')}</dt>
          <dd className="num">
            <strong className="debt-amount">{formatVND(remain)}</strong>
          </dd>
          <dt>{t('detail.dueDate')}</dt>
          <dd>{formatDate(invoice.due_date)}</dd>
          <dt>{t('detail.createdAt')}</dt>
          <dd>{formatDateTime(invoice.created_at)}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="section-head">
          <h3>{t('detail.payments')}</h3>
        </div>
        {payments.length === 0 ? (
          <EmptyState
            icon="banknote"
            title={t('detail.noPaymentsTitle')}
            desc={t('detail.noPaymentsDesc')}
            action={
              canCollect && remain > 0 ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(true)}>
                  {t('detail.collect')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap sticky">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('detail.paymentsTable.date')}</th>
                  <th scope="col" className="th-right">
                    {t('detail.paymentsTable.amount')}
                  </th>
                  <th scope="col">{t('detail.paymentsTable.method')}</th>
                  <th scope="col">{t('detail.paymentsTable.status')}</th>
                  <th scope="col">{t('detail.paymentsTable.note')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.paid_at)}</td>
                    <td className="num">{formatVND(p.amount)}</td>
                    <td>{paymentMethodLabel(p.method, (k) => t(k)) || <EmptyCell />}</td>
                    <td>
                      <span className={`badge ${PAYMENT_STATUS_BADGE[p.status]}`}>
                        {t(`detail.paymentStatus.${p.status}`)}
                      </span>
                    </td>
                    <td>{p.note || <EmptyCell />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paying && (
        <PayModal
          invoice={invoice}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            void load();
          }}
        />
      )}
      {showReceipt && (
        <ReceiptModal
          invoice={invoice}
          centerName={getUser()?.center_name || t('receipt.defaultCenter')}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}
