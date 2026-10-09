/**
 * API layer cho feature Đơn nghỉ phép (staff).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { LeaveRequest } from '../../shared/types';

export interface MakeupSuggestion {
  session_id: number;
  date: string;
  topic: string | null;
}

export const leavesApi = {
  list: (status = '', page?: PageParams) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<LeaveRequest>>(qs ? `/leaves?${qs}` : '/leaves');
  },
  approve: (id: number) =>
    http.post<{ ok: boolean; suggestions: MakeupSuggestion[] }>(`/leaves/${id}/approve`),
  reject: (id: number) => http.post<{ ok: boolean }>(`/leaves/${id}/reject`),
};
