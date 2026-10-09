import { useCallback, useEffect, useState } from 'react';
import { reviewsApi } from './growth.api';
import { useToast } from '../../shared/ui/toast';
import { ConfirmDialog } from '../../shared/components/Modal';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { ReviewItem, REVIEW_STATUS_LABEL, labelOf, formatDate } from '../../shared/types';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rating ? 'star on' : 'star'}>
          ★
        </span>
      ))}
    </span>
  );
}

export function ReviewsAdmin() {
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<ReviewItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const switchTab = (t: 'pending' | 'approved') => {
    setTab(t);
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reviewsApi.list(tab, { page });
      setReviews(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được đánh giá', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (r: ReviewItem, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') await reviewsApi.approve(r.id);
      else await reviewsApi.reject(r.id);
      toast(action === 'approve' ? 'Đã duyệt đánh giá' : 'Đã từ chối đánh giá', 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await reviewsApi.remove(deleting.id);
      toast('Đã xóa đánh giá', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Đánh giá của phụ huynh"
        desc="Duyệt đánh giá để hiển thị công khai trên landing page"
      />

      <div className="tabs">
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => switchTab('pending')}>
          Chờ duyệt
        </button>
        <button className={`tab${tab === 'approved' ? ' active' : ''}`} onClick={() => switchTab('approved')}>
          Đã duyệt
        </button>
      </div>

      {loading ? (
        <CardGridSkeleton count={3} />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="star"
          title="Chưa có đánh giá nào"
          desc={
            tab === 'pending' ? 'Chưa có đánh giá nào đang chờ duyệt.' : 'Chưa có đánh giá nào được duyệt.'
          }
        />
      ) : (
        <div className="card-grid">
          {reviews.map((r) => (
            <div key={r.id} className="card review-card">
              <div className="card-head">
                <Stars rating={r.rating} />
                <span className={`badge badge-${r.status}`}>{labelOf(REVIEW_STATUS_LABEL, r.status)}</span>
              </div>
              <p className="review-comment">{r.comment || '—'}</p>
              <p className="muted">
                — {r.parent_name || 'Phụ huynh'} · {formatDate(r.created_at)}
              </p>
              <div className="card-foot">
                {tab === 'pending' ? (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => void moderate(r, 'approve')}>
                      Duyệt
                    </button>
                    <button
                      className="btn btn-sm btn-danger-ghost"
                      onClick={() => void moderate(r, 'reject')}
                    >
                      Từ chối
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(r)}>
                    Xóa
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {deleting && (
        <ConfirmDialog
          title="Xóa đánh giá"
          message="Xóa đánh giá này khỏi trang public?"
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}
