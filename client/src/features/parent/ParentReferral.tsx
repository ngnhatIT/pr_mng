import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parentApi, ReferralData } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { formatDate } from '../../shared/types';
import './parent.css';

export function ParentReferral() {
  const { t } = useTranslation(['parent', 'common']);
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
      toast(err instanceof Error ? err.message : t('referral.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading)
    return (
      <div className="parent-page">
        <h1 className="parent-title">{t('referral.title')}</h1>
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
        <h1 className="parent-title">{t('referral.title')}</h1>
        <EmptyState icon="gift" title={t('referral.dataErrorTitle')} desc={t('referral.dataErrorDesc')} />
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
            value={data.share_link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-primary" onClick={() => void copyLink()}>
            {copied ? t('referral.copied') : t('referral.copyLink')}
          </button>
        </div>
      </section>

      <div className="stat-grid stat-grid-3">
        <div className="stat-card">
          <div className="stat-value">{data.stats.total}</div>
          <div className="stat-label">{t('referral.statTotal')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.stats.pending}</div>
          <div className="stat-label">{t('referral.statPending')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.stats.rewarded}</div>
          <div className="stat-label">{t('referral.statRewarded')}</div>
        </div>
      </div>

      <section className="card">
        <h3 className="card-title">{t('referral.creditsTitle')}</h3>
        <div className="stat-grid stat-grid-3">
          <div className="stat-card">
            <div className="stat-value">{data.credits.total}</div>
            <div className="stat-label">{t('referral.creditsTotal')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{data.credits.used}</div>
            <div className="stat-label">{t('referral.creditsUsed')}</div>
          </div>
          <div className="stat-card stat-card-highlight">
            <div className="stat-value">{data.credits.available}</div>
            <div className="stat-label">{t('referral.creditsAvailable')}</div>
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
