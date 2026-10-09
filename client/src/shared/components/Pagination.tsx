/**
 * Component phân trang dùng chung.
 * Dùng kèm API trả về envelope { data, pagination: { page, limit, total, totalPages } }.
 */
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
}

export function Pagination({ pagination, onChange }: Props) {
  const { page, totalPages, total, limit } = pagination;
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  // Hiển thị tối đa 5 nút số trang quanh trang hiện tại
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <div className="pagination">
      <span className="pagination-info">
        {from}–{to} / {total.toLocaleString('vi-VN')}
      </span>
      <div className="pagination-buttons">
        <button
          className="btn btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(1)}
          aria-label="Trang đầu"
        >
          «
        </button>
        <button
          className="btn btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Trang trước"
        >
          ‹
        </button>
        {pages.map((p) => (
          <button
            key={p}
            className={`btn btn-sm${p === page ? ' btn-primary' : ''}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ))}
        <button
          className="btn btn-sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Trang sau"
        >
          ›
        </button>
        <button
          className="btn btn-sm"
          disabled={page >= totalPages}
          onClick={() => onChange(totalPages)}
          aria-label="Trang cuối"
        >
          »
        </button>
      </div>
    </div>
  );
}
