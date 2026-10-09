import { useCallback, useEffect, useState } from 'react';
import { parentApi, ReferralData } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { formatDate } from '../../shared/types';
import './parent.css';

export function ParentReferral() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await parentApi.referral();
      setData(d);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được thông tin giới thiệu', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = async () => {
    if (!data?.share_link) return;
    try {
      await navigator.clipboard.writeText(data.share_link);
      setCopied(true);
      toast('Đã sao chép link giới thiệu', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Không sao chép được, vui lòng copy thủ công', 'error');
    }
  };

  if (loading)
    return (
      <div className="parent-page">
        <h1 className="parent-title">Giới thiệu bạn bè</h1>
        <section className="card" aria-hidden="true">
          <Skeleton width="40%" height={18} />
          <div style={{ marginTop: 12 }}>
            <Skeleton height={44} radius={8} />
          </div>
        </section>
        <div className="stat-grid stat-grid-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="stat-card">
              <Skeleton width="40%" height={26} />
              <div style={{ marginTop: 10 }}>
                <Skeleton width="70%" height={13} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="parent-page">
        <h1 className="parent-title">Giới thiệu bạn bè</h1>
        <EmptyState icon="gift" title="Không tải được dữ liệu" desc="Vui lòng thử tải lại trang." />
      </div>
    );

  return (
    <div className="parent-page">
      <h1 className="parent-title">Giới thiệu bạn bè</h1>
      <p className="muted">
        Chia sẻ mã giới thiệu cho bạn bè đăng ký học thử - cả bạn và người được giới thiệu đều nhận ưu đãi
        credits.
      </p>

      <section className="card referral-code-card">
        <h3 className="card-title">Mã giới thiệu của bạn</h3>
        <div className="referral-code">{data.referral_code}</div>
        <div className="referral-link-row">
          <input
            className="text-input mono"
            value={data.share_link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-primary" onClick={() => void copyLink()}>
            {copied ? 'Đã sao chép' : 'Sao chép link'}
          </button>
        </div>
      </section>

      <div className="stat-grid stat-grid-3">
        <div className="stat-card">
          <div className="stat-value">{data.stats.total}</div>
          <div className="stat-label">Lượt giới thiệu</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.stats.pending}</div>
          <div className="stat-label">Đang chờ thưởng</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.stats.rewarded}</div>
          <div className="stat-label">Đã thưởng</div>
        </div>
      </div>

      <section className="card">
        <h3 className="card-title">Credits của bạn</h3>
        <div className="stat-grid stat-grid-3">
          <div className="stat-card">
            <div className="stat-value">{data.credits.total}</div>
            <div className="stat-label">Tổng</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{data.credits.used}</div>
            <div className="stat-label">Đã dùng</div>
          </div>
          <div className="stat-card stat-card-highlight">
            <div className="stat-value">{data.credits.available}</div>
            <div className="stat-label">Còn lại</div>
          </div>
        </div>
        <p className="muted">
          Credits có thể dùng để trừ vào học phí - liên hệ trung tâm khi đóng học phí để được áp dụng.
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">Lịch sử giới thiệu</h3>
        {data.referrals.length === 0 ? (
          <EmptyState
            icon="gift"
            title="Chưa có lượt giới thiệu nào"
            desc="Chia sẻ mã giới thiệu của bạn để nhận credits."
          />
        ) : (
          <ul className="list">
            {data.referrals.map((r) => (
              <li key={r.id} className="list-item">
                <div>
                  <strong className="mono">{r.referred_phone}</strong>
                  <div className="muted">{formatDate(r.created_at)}</div>
                </div>
                <span className={`badge badge-${r.status === 'rewarded' ? 'rewarded' : 'pending'}`}>
                  {r.status === 'rewarded' ? 'Đã thưởng' : 'Đang chờ'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
