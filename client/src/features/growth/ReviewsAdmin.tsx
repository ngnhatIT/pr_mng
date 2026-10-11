import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewsApi } from './growth.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { Icon } from '../../shared/components/icons';
import { ReviewItem, formatDate } from '../../shared/types';
import './Growth.css';
import { EmptyCell } from '../../shared/components/EmptyCell';
import { Tabs, tabPanelProps } from '../../shared/components/Tabs';

function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation(['ops', 'common']);
  return (
    <span className="stars-svg" role="img" aria-label={t('reviews.starsAria', { rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={15} className={i <= rating ? 'star-svg on' : 'star-svg'} />
      ))}
    </span>
  );
}

export function ReviewsAdmin() {
  const { t } = useTranslation(['ops', 'common']);
  const [q, setQ] = useUrlState({ tab: 'pending', page: '1' });
  const tab: 'pending' | 'approved' = q.tab === 'approved' ? 'approved' : 'pending';
  const page = Number(q.page) || 1;
  const [deleting, setDeleting] = useState<ReviewItem | null>(null);
  const toast = useToast();

  const switchTab = (tb: 'pending' | 'approved') => setQ({ tab: tb, page: '1' });

  const { data, loading, error, reload } = useLoad(() => reviewsApi.list(tab, { page }), [tab, page]);
  const reviews = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới
  useEffect(() => {
    if (error) toastApiError(toast, error, t('reviews.toast.loadFail'));
  }, [error, toast, t]);

  // Id review đang duyệt/từ chối: chống bấm 2 lần (pattern như Tuition moderate)
  const [busyId, setBusyId] = useState<number | null>(null);

  const moderate = async (r: ReviewItem, action: 'approve' | 'reject') => {
    if (busyId !== null) return;
    setBusyId(r.id);
    try {
      if (action === 'approve') await reviewsApi.approve(r.id);
      else await reviewsApi.reject(r.id);
      toast(action === 'approve' ? t('reviews.toast.approved') : t('reviews.toast.rejected'), 'success');
      reload();
    } catch (err) {
      toastApiError(toast, err, t('reviews.toast.moderateFail'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await reviewsApi.remove(deleting.id);
      toast(t('reviews.toast.deleted'), 'success');
      setDeleting(null);
      reload();
    } catch (err) {
      toastApiError(toast, err, t('reviews.toast.deleteFail'));
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('reviews.title')} desc={t('reviews.desc')} />

      <Tabs
        id="reviews"
        tabs={(['pending', 'approved'] as const).map((k) => ({
          key: k,
          label: (
            <>
              {t(`reviews.tabs.${k}`)}
              {tab === k && pagination && pagination.total > 0 && (
                <span className="tab-count">{pagination.total}</span>
              )}
            </>
          ),
        }))}
        value={tab}
        onChange={switchTab}
      />

      <div {...tabPanelProps('reviews', tab)}>
        {loading && !data ? (
          <CardGridSkeleton count={3} />
        ) : error && !data ? (
          <LoadError onRetry={reload} />
        ) : reviews.length === 0 ? (
          <EmptyState
            icon="star"
            title={t('reviews.empty.title')}
            desc={tab === 'pending' ? t('reviews.empty.pendingDesc') : t('reviews.empty.approvedDesc')}
          />
        ) : (
          <div className="card-grid" aria-busy={loading || undefined}>
            {reviews.map((r) => (
              <div key={r.id} className="card review-card">
                <div className="review-head">
                  <Stars rating={r.rating} />
                  <span className={`badge badge-${r.status}`}>{t(`reviews.status.${r.status}`)}</span>
                </div>
                <p className="review-comment">{r.comment || <EmptyCell />}</p>
                <div className="review-meta">
                  <Icon name="user" size={13} />
                  <span>{r.parent_name || t('reviews.anonymousParent')}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(r.created_at)}</span>
                </div>
                <div className="review-foot">
                  {tab === 'pending' ? (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => void moderate(r, 'approve')}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          <Icon name="check" size={14} />
                        )}
                        {t('reviews.approve')}
                      </button>
                      <button
                        className="btn btn-sm btn-danger-ghost"
                        onClick={() => void moderate(r, 'reject')}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? (
                          <span className="spinner spinner-dark" aria-hidden="true" />
                        ) : (
                          <Icon name="x" size={14} />
                        )}
                        {t('reviews.reject')}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(r)}>
                      <Icon name="trash" size={14} />
                      {t('actions.delete', { ns: 'common' })}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {pagination && (
          <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={t('reviews.delete.title')}
          message={t('reviews.delete.message')}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}
