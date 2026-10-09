/**
 * API layer cho feature Hệ thống (quản lý trung tâm - superadmin).
 */
import { http } from '../../shared/api/client';
import { CenterItem } from '../../shared/types';

export interface CenterForm {
  name: string;
  subdomain: string;
  phone: string | null;
  address: string | null;
  plan: string;
  plan_expires_at: string | null;
  admin_username: string;
  admin_password: string;
}

export interface PlanUpdate {
  plan: string;
  plan_expires_at: string | null;
}

export const systemApi = {
  listCenters: () => http.get<CenterItem[]>('/centers'),
  createCenter: (form: CenterForm) => http.post<CenterItem>('/centers', form),
  updatePlan: (id: number, plan: PlanUpdate) => http.put<CenterItem>(`/centers/${id}`, plan),
};
