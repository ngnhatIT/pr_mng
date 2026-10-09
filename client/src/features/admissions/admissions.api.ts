/**
 * API layer cho feature Tuyển sinh (Leads / Trials).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { LeadItem, TrialItem } from '../../shared/types';
import { ClassItem } from '../classes/classes.api';

export interface LeadForm {
  name: string;
  phone: string;
  note: string;
}

export const leadsApi = {
  list: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<LeadItem>>(qs ? `/leads?${qs}` : '/leads');
  },
  create: (form: LeadForm) => http.post<LeadItem>('/leads', form),
  update: (id: number, form: LeadForm) => http.put<LeadItem>(`/leads/${id}`, form),
  setStatus: (id: number, status: string) => http.put<LeadItem>(`/leads/${id}`, { status }),
  remove: (id: number) => http.del<{ ok: boolean }>(`/leads/${id}`),
  convert: (id: number, classId: number | null) =>
    http.post<{ student_id: number }>(`/leads/${id}/convert`, { class_id: classId }),
};

export const trialsApi = {
  list: (status = '', page?: PageParams) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<TrialItem>>(qs ? `/trials?${qs}` : '/trials');
  },
  setStatus: (id: number, status: string) => http.put<TrialItem>(`/trials/${id}`, { status }),
  remove: (id: number) => http.del<{ ok: boolean }>(`/trials/${id}`),
  convert: (id: number, classId: number | null) =>
    http.post<{ student_id: number }>(`/trials/${id}/convert`, { class_id: classId }),
  listClasses: () => http.get<Paginated<ClassItem>>('/classes?limit=100').then((r) => r.data),
};
