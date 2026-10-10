/**
 * Component phân trang dùng chung.
 * Dùng kèm API trả về envelope { data, pagination: { page, limit, total, totalPages } }.
 */
import { useTranslation } from 'react-i18next';
import './Pagination.css';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Props {
  pagination: PaginationMeta;
  onChange: (page: number) => void;
  /** Đang tải trang mới: vô hiệu hóa nút để tránh bấm trùng, giữ nguyên layout */
  loading?: boolean;
}

export function Pagination({ pagination, onChange, loading = false }: Props) {
  const { t, i18n } = useTranslation('common');
  const { page, totalPages, total, limit } = pagination;
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  // Hiển thị tối đa 5 nút số trang quanh trang hiện tại
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <div className="pagination" aria-busy={loading || undefined}>
      <span className="pagination-info">
        {from}–{to} / {total.toLocaleString(i18n.language === 'en' ? 'en-US' : 'vi-VN')} ·{' '}
        {t('pagination.pageOf', { page, totalPages })}
      </span>
      <div className="pagination-buttons">
        <button
          className="btn btn-sm"
          disabled={loading || atStart}
          onClick={() => onChange(1)}
          aria-label={t('pagination.first')}
        >
          «
        </button>
        <button
          className="btn btn-sm"
          disabled={loading || atStart}
          onClick={() => onChange(page - 1)}
          aria-label={t('pagination.prev')}
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            className={`btn btn-sm${p === page ? ' btn-primary' : ''}`}
            disabled={loading}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ))}
        <button
          className="btn btn-sm"
          disabled={loading || atEnd}
          onClick={() => onChange(page + 1)}
          aria-label={t('pagination.next')}
        >
          ›
        </button>
        <button
          className="btn btn-sm"
          disabled={loading || atEnd}
          onClick={() => onChange(totalPages)}
          aria-label={t('pagination.last')}
        >
          »
        </button>
      </div>
    </div>
  );
}
