import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi } from './parent.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { useLoad } from '../../shared/hooks/useLoad';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { formatDate, formatVND } from '../../shared/types';
import './parent.css';

export function ParentReferral() {
  const { t } = useTranslation(['parent', 'common']);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => parentApi.referral(), []);
  useEffect(() => {
    if (error) toastApiError(toast, error, t('referral.loadError'));
  }, [error, toast, t]);

  const copyLink = async () => {
    if (!data?.share_link) return;
    try {
      await navigator.clipboard.writeText(data.share_link);
      setCopied(true);
      toast(t('referral.linkCopied'), 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t('referral.copyError'), 'error');
    }
  };

  if (loading && !data)
    return (
      <div className="parent-page">
        <h1 className="parent-title">{t('referral.title')}</h1>
        <section className="card" aria-hidden="true">
          <Skeleton width="40%" height={18} />
          <div style={{ marginTop: 12 }}>
            <Skeleton height={44} radius={8} />
          </div>
        </section>
        <div className="stat-strip stat-strip-compact" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="stat-strip-item">
              <Skeleton width="40%" height={26} />
              <div style={{ marginTop: 8 }}>
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
        <h1 className="parent-title">{t('referral.title')}</h1>
        <LoadError title={t('referral.dataErrorTitle')} onRetry={reload} />
      </div>
    );

  return (
    <div className="parent-page">
      <h1 className="parent-title">{t('referral.title')}</h1>
      <p className="muted">{t('referral.subtitle')}</p>

      <section className="card referral-code-card">
        <h3 className="card-title">{t('referral.yourCode')}</h3>
        <div className="referral-code">{data.referral_code}</div>
        <div className="referral-link-row">
          <input
            className="text-input mono"
            aria-label={t('referral.linkLabel')}
            value={data.share_link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-primary" onClick={() => void copyLink()}>
            {copied ? t('referral.copied') : t('referral.copyLink')}
          </button>
        </div>
      </section>

      <div className="stat-strip stat-strip-compact">
        <div className="stat-strip-item">
          <span className="stat-strip-label">{t('referral.statTotal')}</span>
          <span className="stat-strip-value">{data.stats.total}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">{t('referral.statPending')}</span>
          <span className="stat-strip-value">{data.stats.pending}</span>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-label">{t('referral.statRewarded')}</span>
          <span className="stat-strip-value">{data.stats.rewarded}</span>
        </div>
      </div>

      <section className="card">
        <h3 className="card-title">{t('referral.creditsTitle')}</h3>
        <div className="stat-strip stat-strip-compact">
          <div className="stat-strip-item">
            <span className="stat-strip-label">{t('referral.creditsTotal')}</span>
            <span className="stat-strip-value">{formatVND(data.credits.total)}</span>
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">{t('referral.creditsUsed')}</span>
            <span className="stat-strip-value">{formatVND(data.credits.used)}</span>
          </div>
          <div className="stat-strip-item">
            <span className="stat-strip-label">{t('referral.creditsAvailable')}</span>
            <span className="stat-strip-value is-strong">{formatVND(data.credits.available)}</span>
          </div>
        </div>
        <p className="muted">{t('referral.creditsNote')}</p>
      </section>

      <section className="card">
        <h3 className="card-title">{t('referral.historyTitle')}</h3>
        {data.referrals.length === 0 ? (
          <EmptyState
            icon="gift"
            title={t('referral.historyEmptyTitle')}
            desc={t('referral.historyEmptyDesc')}
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
                  {r.status === 'rewarded' ? t('referral.rewarded') : t('referral.pending')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
