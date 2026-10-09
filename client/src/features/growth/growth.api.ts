/**
 * API layer cho feature Tăng trưởng (Referrals / Reviews).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { ReferralItem, ReviewItem } from '../../shared/types';

export interface ReferralStats {
  total: number;
  pending: number;
  rewarded: number;
}

export const referralsApi = {
  list: (status = '', page?: PageParams) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<ReferralItem>>(qs ? `/referrals?${qs}` : '/referrals');
  },
  stats: () => http.get<ReferralStats>('/referrals/stats'),
};

export const reviewsApi = {
  list: (status: 'pending' | 'approved', page?: PageParams) => {
    const q = new URLSearchParams({ status });
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<ReviewItem>>(`/reviews?${q.toString()}`);
  },
  approve: (id: number) => http.post<{ ok: boolean }>(`/reviews/${id}/approve`),
  reject: (id: number) => http.post<{ ok: boolean }>(`/reviews/${id}/reject`),
  remove: (id: number) => http.del<{ ok: boolean }>(`/reviews/${id}`),
};
