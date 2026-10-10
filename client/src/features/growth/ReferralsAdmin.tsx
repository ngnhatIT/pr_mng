import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { referralsApi, ReferralStats } from './growth.api';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton, StatGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { StatCard } from '../../shared/components/StatCard';
import { ReferralItem, formatDate } from '../../shared/types';
import './Growth.css';

export function ReferralsAdmin() {
  const { t } = useTranslation(['ops', 'common']);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([referralsApi.list(status, { page }), referralsApi.stats()]);
      setReferrals(list.data);
      setPagination(list.pagination);
      setStats(st);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('referrals.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader title={t('referrals.title')} desc={t('referrals.desc')} />

      {loading ? (
        <>
          <StatGridSkeleton count={3} />
          <div className="referral-skel-spacer" aria-hidden="true" />
          <TableSkeleton cols={5} />
        </>
      ) : (
        <>
          {stats && (
            <div className="stat-grid stat-grid-3">
              <StatCard icon="users" tone="blue" value={stats.total} label={t('referrals.stats.total')} />
              <StatCard
                icon="clock"
                tone="amber"
                value={stats.pending}
                label={t('referrals.stats.pending')}
              />
              <StatCard
                icon="gift"
                tone="green"
                value={stats.rewarded}
                label={t('referrals.stats.rewarded')}
              />
            </div>
          )}

          <div className="toolbar">
            <select
              className="text-input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label={t('referrals.filterLabel')}
            >
              <option value="">{t('referrals.allStatuses')}</option>
              <option value="pending">{t('referrals.status.pending')}</option>
              <option value="rewarded">{t('referrals.status.rewarded')}</option>
            </select>
          </div>

          {referrals.length === 0 ? (
            <EmptyState icon="gift" title={t('referrals.empty.title')} desc={t('referrals.empty.desc')} />
          ) : (
            <div className="table-wrap sticky">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('referrals.col.referrer')}</th>
                    <th scope="col">{t('referrals.col.referred')}</th>
                    <th scope="col">{t('referrals.col.status')}</th>
                    <th scope="col">{t('referrals.col.reward')}</th>
                    <th scope="col">{t('referrals.col.createdAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.referrer_name || <span className="muted">{t('referrals.noName')}</span>}
                        <div className="muted mono">{r.referrer_phone}</div>
                      </td>
                      <td>
                        {r.referred_student_name || r.referred_name || (
                          <span className="muted">{t('referrals.noName')}</span>
                        )}
                        <div className="muted mono">{r.referred_phone}</div>
                      </td>
                      <td>
                        <span className={`badge badge-${r.status === 'rewarded' ? 'rewarded' : 'pending'}`}>
                          {r.status === 'rewarded'
                            ? t('referrals.status.rewarded')
                            : t('referrals.status.pending')}
                        </span>
                      </td>
                      <td className="num">{r.reward_amount != null ? r.reward_amount : '-'}</td>
                      <td>{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}
        </>
      )}
    </div>
  );
}
