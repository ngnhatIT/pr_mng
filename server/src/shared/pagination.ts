/**
 * Pagination chuẩn cho mọi API danh sách.
 *
 * Query params: ?page=1&limit=20 (page bắt đầu từ 1)
 * Response envelope:
 *   { data: [...], pagination: { page, limit, total, totalPages } }
 *
 * Ví dụ trong service:
 *   import { parsePagination, paginate } from '../../shared/pagination';
 *   export function listStudents(centerId, query, pageOpts) {
 *     const { page, limit, offset } = parsePagination(pageOpts);
 *     const total = countQuery(...);
 *     const rows = db.prepare(`... LIMIT ? OFFSET ?`).all(..., limit, offset);
 *     return paginate(rows, total, page, limit);
 *   }
 */

export interface PageOptions {
  page?: unknown;
  limit?: unknown;
}

export interface ParsedPage {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Parse page/limit từ query, clamp về giá trị hợp lệ. */
export function parsePagination(opts: PageOptions = {}): ParsedPage {
  let page = Number(opts.page);
  let limit = Number(opts.limit);
  if (!Number.isFinite(page) || page < 1) page = DEFAULT_PAGE;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  page = Math.floor(page);
  limit = Math.min(Math.floor(limit), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

/** Đóng gói rows + total thành envelope chuẩn. */
export function paginate<T>(rows: T[], total: number, page: number, limit: number): Paginated<T> {
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
