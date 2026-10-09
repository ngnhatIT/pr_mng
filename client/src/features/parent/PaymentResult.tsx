import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/components/icons';

export function PaymentResult() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const success = status === 'success' || status === '00' || status === 'paid';

  return (
    <div className="parent-page">
      <div className="card payment-result">
        <div className={`result-icon ${success ? 'result-success' : 'result-fail'}`}>
          <Icon name={success ? 'check' : 'x'} size={34} />
        </div>
        <h1 className="parent-title">{success ? 'Thanh toán thành công!' : 'Thanh toán chưa thành công'}</h1>
        <p className="muted">
          {success
            ? 'Học phí đã được thanh toán. Cảm ơn bạn!'
            : 'Giao dịch không hoàn tất. Vui lòng thử lại hoặc liên hệ trung tâm để được hỗ trợ.'}
        </p>
        <Link className="btn btn-primary btn-block" to="/parent">
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}
