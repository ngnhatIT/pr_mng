/**
 * API layer cho feature Tổng quan (Dashboard).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { DashboardData } from '../../shared/types';
import { DebtRow } from '../tuition/tuition.api';

export const dashboardApi = {
  summary: () => http.get<DashboardData>('/dashboard'),
  topDebts: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<DebtRow>>(qs ? `/invoices/debt?${qs}` : '/invoices/debt');
  },
};
