import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { referralsApi } from './growth.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton, StatGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { StatCard } from '../../shared/components/StatCard';
import { formatDate, formatVND } from '../../shared/types';
import { EmptyCell } from '../../shared/components/EmptyCell';
import './Growth.css';

export function ReferralsAdmin() {
  const { t } = useTranslation(['ops', 'common']);
  const [q, setQ] = useUrlState({ status: '', page: '1' });
  const { status } = q;
  const page = Number(q.page) || 1;
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(
    () => Promise.all([referralsApi.list(status, { page }), referralsApi.stats()]),
    [status, page]
  );
  const referrals = data?.[0].data ?? [];
  const pagination = data?.[0].pagination ?? null;
  const stats = data?.[1] ?? null;

  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data[0].pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới
  useEffect(() => {
    if (error) toastApiError(toast, error, t('referrals.toast.loadFail'));
  }, [error, toast, t]);

  return (
    <div className="page">
      <PageHeader title={t('referrals.title')} desc={t('referrals.desc')} />

      {loading && !data ? (
        <>
          <StatGridSkeleton count={3} />
          <div className="referral-skel-spacer" aria-hidden="true" />
          <TableSkeleton cols={5} />
        </>
      ) : error && !data ? (
        <LoadError onRetry={reload} />
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
              onChange={(e) => setQ({ status: e.target.value, page: '1' })}
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
            <div className="table-wrap sticky" aria-busy={loading || undefined}>
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
                      <td className="num">
                        {r.reward_amount != null ? formatVND(r.reward_amount) : <EmptyCell />}
                      </td>
                      <td>{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && (
            <Pagination
              pagination={pagination}
              onChange={(p) => setQ({ page: String(p) })}
              loading={loading}
            />
          )}
        </>
      )}
    </div>
  );
}
