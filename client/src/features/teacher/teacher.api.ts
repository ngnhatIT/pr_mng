/**
 * API layer cho feature Cổng giáo viên (TeacherToday / TeacherGrades / TeacherSalary).
 * Page chỉ import từ đây - không gọi http trực tiếp với URL string rải rác.
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { TeacherTodayItem, Grade } from '../../shared/types';
import { ClassItem } from '../classes/classes.api';

export interface CheckinResult {
  ok: boolean;
  session_id: number;
  class_name: string;
  date: string;
}

export interface SalaryInfo {
  sessions: number;
  per_session: number;
  total: number;
}

export interface GradeInput {
  student_id: number;
  class_id: number | null;
  title: string;
  score: number;
  max_score?: number;
  comment?: string | null;
}

export interface ClassStudents {
  class: ClassItem;
  students: { id: number; name: string; code: string }[];
}

export const teacherApi = {
  today: () => http.get<TeacherTodayItem[]>('/teacher/today'),
  checkin: (code: string) => http.post<CheckinResult>('/teacher/checkin', { code }),
  payroll: (month: string) => http.get<SalaryInfo>(`/teacher/payroll?month=${month}`),

  listClasses: () => http.get<Paginated<ClassItem>>('/classes?limit=100').then((r) => r.data),
  classStudents: (classId: number | string) => http.get<ClassStudents>(`/classes/${classId}`),

  listGrades: (studentId: string, classId: string, page?: PageParams) => {
    const q = new URLSearchParams();
    q.set('student_id', studentId);
    if (classId) q.set('class_id', classId);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<Grade>>(`/grades?${q.toString()}`);
  },
  createGrade: (data: GradeInput) => http.post<Grade>('/grades', data),
  deleteGrade: (id: number) => http.del<{ ok: boolean }>(`/grades/${id}`),
};
