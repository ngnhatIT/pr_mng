import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviewsApi } from './growth.api';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { ReviewItem, formatDate } from '../../shared/types';
import './Growth.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

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
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<ReviewItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const switchTab = (tb: 'pending' | 'approved') => {
    setTab(tb);
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reviewsApi.list(tab, { page });
      setReviews(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('reviews.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (r: ReviewItem, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') await reviewsApi.approve(r.id);
      else await reviewsApi.reject(r.id);
      toast(action === 'approve' ? t('reviews.toast.approved') : t('reviews.toast.rejected'), 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('reviews.toast.moderateFail'), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await reviewsApi.remove(deleting.id);
      toast(t('reviews.toast.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('reviews.toast.deleteFail'), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('reviews.title')} desc={t('reviews.desc')} />

      <div className="tabs">
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => switchTab('pending')}>
          {t('reviews.tabs.pending')}
          {tab === 'pending' && pagination && pagination.total > 0 && (
            <span className="tab-count">{pagination.total}</span>
          )}
        </button>
        <button className={`tab${tab === 'approved' ? ' active' : ''}`} onClick={() => switchTab('approved')}>
          {t('reviews.tabs.approved')}
          {tab === 'approved' && pagination && pagination.total > 0 && (
            <span className="tab-count">{pagination.total}</span>
          )}
        </button>
      </div>

      {loading && reviews.length === 0 ? (
        <CardGridSkeleton count={3} />
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
                    <button className="btn btn-sm btn-primary" onClick={() => void moderate(r, 'approve')}>
                      <Icon name="check" size={14} />
                      {t('reviews.approve')}
                    </button>
                    <button
                      className="btn btn-sm btn-danger-ghost"
                      onClick={() => void moderate(r, 'reject')}
                    >
                      <Icon name="x" size={14} />
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

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}

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
