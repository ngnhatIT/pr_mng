/**
 * API layer cho feature Nhân sự (Teachers / Payroll).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { Teacher, PayrollRow } from '../../shared/types';

export interface TeacherForm {
  name: string;
  phone: string;
  email: string;
  subject: string;
}

export const peopleApi = {
  listTeachers: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<Teacher>>(qs ? `/teachers?${qs}` : '/teachers');
  },
  createTeacher: (form: TeacherForm) => http.post<Teacher>('/teachers', form),
  updateTeacher: (id: number, form: TeacherForm) => http.put<Teacher>(`/teachers/${id}`, form),
  deleteTeacher: (id: number) => http.del<{ ok: boolean }>(`/teachers/${id}`),
  createAccount: (teacherId: number, username: string, password: string) =>
    http.post<{ ok: boolean }>(`/teachers/${teacherId}/account`, { username, password }),

  payroll: (month: string) => http.get<PayrollRow[]>(`/payroll?month=${month}`),
  savePayRule: (teacherId: number, perSessionAmount: number) =>
    http.put<{ ok: boolean }>('/payroll/rules', {
      teacher_id: teacherId,
      per_session_amount: perSessionAmount,
    }),
};
