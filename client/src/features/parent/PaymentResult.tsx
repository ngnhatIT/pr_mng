import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../shared/components/icons';
import { http } from '../../shared/api/client';
import './parent.css';

const POLL_EVERY_MS = 5000;
const MAX_POLLS = 12; // ~1 phút

export function PaymentResult() {
  const { t } = useTranslation(['parent', 'common']);
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const ref = searchParams.get('ref');
  const [status, setStatus] = useState<string | null>(statusParam);
  const [polling, setPolling] = useState(statusParam === 'pending' && !!ref);
  const pollsRef = useRef(0);

  // IPN (server-to-server) mới là nơi ghi nhận tiền; return về trước IPN -> pending.
  // Tự poll trạng thái mỗi 5s, tối đa ~1 phút rồi dừng để phụ huynh không chờ vô hạn
  // và không hoảng mà bấm thanh toán lại.
  useEffect(() => {
    if (statusParam !== 'pending' || !ref) return;
    let stopped = false;
    const stop = () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        setPolling(false);
      }
    };
    const timer = setInterval(() => {
      void (async () => {
        pollsRef.current += 1;
        let done = pollsRef.current >= MAX_POLLS;
        try {
          const r = await http.get<{ status: string }>(
            `/parent/vnpay-txn-status?ref=${encodeURIComponent(ref)}`
          );
          if (r.status === 'confirmed') {
            setStatus('success');
            done = true;
          } else if (r.status === 'failed') {
            setStatus('failed');
            done = true;
          }
          // pending: poll tiếp
        } catch {
          // Lỗi mạng lần này: bỏ qua, thử lại lần sau
        }
        if (done) stop();
      })();
    }, POLL_EVERY_MS);
    return stop;
  }, [statusParam, ref]);

  const success = status === 'success' || status === '00' || status === 'paid';
  const pending = !success && status === 'pending';

  return (
    <div className="parent-page">
      <div className="card payment-result">
        <div className={`result-icon${success ? ' result-success' : pending ? '' : ' result-fail'}`}>
          <Icon name={success ? 'check' : pending ? 'clock' : 'x'} size={38} />
        </div>
        <span className={`badge ${success ? 'badge-paid' : pending ? 'badge-upcoming' : 'badge-overdue'}`}>
          {success ? t('payment.paidBadge') : pending ? t('payment.pendingBadge') : t('payment.failBadge')}
        </span>
        <h1 className="parent-title" style={{ marginTop: 12 }}>
          {success ? t('payment.successTitle') : pending ? t('payment.pendingTitle') : t('payment.failTitle')}
        </h1>
        <p className="muted">
          {success ? t('payment.successDesc') : pending ? t('payment.pendingDesc') : t('payment.failDesc')}
        </p>
        {pending && (
          <p className="muted" role="status">
            {polling ? (
              <>
                <span className="spinner spinner-dark" aria-hidden="true" /> {t('payment.pendingChecking')}
              </>
            ) : (
              t('payment.pendingTimeout')
            )}
          </p>
        )}
        <Link className="btn btn-primary btn-block" to="/parent">
          {t('payment.backHome')}
        </Link>
      </div>
    </div>
  );
}
