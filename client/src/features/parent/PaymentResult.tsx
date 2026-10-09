import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function PaymentResult() {
  const { t } = useTranslation(['parent', 'common']);
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const success = status === 'success' || status === '00' || status === 'paid';

  return (
    <div className="parent-page">
      <div className="card payment-result">
        <div className={`result-icon ${success ? 'result-success' : 'result-fail'}`}>
          <Icon name={success ? 'check' : 'x'} size={38} />
        </div>
        <span className={`badge ${success ? 'badge-paid' : 'badge-overdue'}`}>
          {success ? t('payment.paidBadge') : t('payment.pendingBadge')}
        </span>
        <h1 className="parent-title" style={{ marginTop: 12 }}>
          {success ? t('payment.successTitle') : t('payment.failTitle')}
        </h1>
        <p className="muted">
          {success ? t('payment.successDesc') : t('payment.failDesc')}
        </p>
        <Link className="btn btn-primary btn-block" to="/parent">
          {t('payment.backHome')}
        </Link>
      </div>
    </div>
  );
}
