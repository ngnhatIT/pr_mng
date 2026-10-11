/**
 * API layer cho feature Học viên.
 * Page chỉ import từ đây - không gọi http trực tiếp với URL string rải rác.
 */
import { useEffect, useState } from 'react';
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { type Grade, type InvoiceItem } from '../../shared/types';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { useToast, toastApiError } from '../../shared/ui/toast';
import i18n from '../../i18n';

export interface Student {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  address: string | null;
  status: 'studying' | 'paused' | 'quit';
  note: string | null;
  center_id: number | null;
}

export interface StudentDetail {
  student: Student;
  classes: { id: number; name: string; enroll_status: string; enrolled_at: string }[];
  invoices: InvoiceItem[];
}

export interface StudentForm {
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  dob?: string;
  address?: string;
  status?: string;
  note?: string;
}

export type { Grade };

export const studentsApi = {
  list: (search = '', status = '', page?: PageParams) => {
    const q = new URLSearchParams({ search, status });
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<Student>>(`/students?${q}`);
  },
  get: (id: number) => http.get<StudentDetail>(`/students/${id}`),
  create: (form: StudentForm) => http.post<Student>('/students', form),
  update: (id: number, form: StudentForm) => http.put<Student>(`/students/${id}`, form),
  remove: (id: number) => http.del<{ ok: boolean }>(`/students/${id}`),

  listGrades: (studentId: number, page?: PageParams) => {
    const q = new URLSearchParams({ student_id: String(studentId) });
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<Grade>>(`/grades?${q.toString()}`);
  },
  createGrade: (data: {
    student_id: number;
    class_id?: number | null;
    title: string;
    score: number;
    max_score?: number;
    comment?: string | null;
  }) => http.post<Grade>('/grades', data),
  deleteGrade: (id: number) => http.del<{ ok: boolean }>(`/grades/${id}`),
};

/**
 * ADM-6: ô chọn học viên tìm server-side (debounce) thay vì tải sẵn 100 học viên mới nhất rồi lọc ở client
 * (server chặn limit 100 -> học viên cũ không bao giờ hiện). Bỏ qua response cũ khi người dùng gõ tiếp.
 */
export function useStudentSearch(search: string, status = 'studying', limit = 30) {
  const q = useDebounce(search.trim());
  const [results, setResults] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    studentsApi
      .list(q, status, { limit })
      .then((r) => alive && setResults(r.data))
      .catch(
        (err: unknown) => alive && toastApiError(toast, err, i18n.t('states.loadError', { ns: 'common' }))
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, status, limit, toast]);
  return { results, loading: loading || q !== search.trim() };
}
