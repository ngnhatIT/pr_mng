/**
 * API layer cho feature Lớp học / Buổi học / Phòng học.
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';

export interface ClassItem {
  id: number;
  name: string;
  teacher_id: number | null;
  teacher_name: string | null;
  schedule: string | null;
  start_date: string | null;
  end_date: string | null;
  tuition_fee: number;
  max_students: number;
  status: string;
  room_id: number | null;
  room_name: string | null;
  student_count: number;
}

export interface EnrolledStudent {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  student_status: string;
  enrollment_id: number;
  enrolled_at: string;
}

export interface ClassDetail {
  class: ClassItem;
  students: EnrolledStudent[];
  sessionCount: number;
}

export interface ClassForm {
  name: string;
  teacher_id?: number | null;
  schedule?: unknown;
  start_date?: string;
  end_date?: string;
  tuition_fee?: number;
  max_students?: number;
  status?: string;
  room_id?: number | null;
}

export interface SessionItem {
  id: number;
  class_id: number;
  date: string;
  topic: string | null;
  checkin_code: string | null;
  attendance_count?: number;
}

export interface AttendanceRow {
  id: number;
  code: string;
  name: string;
  status: 'present' | 'absent' | 'late' | 'excused' | null;
  note: string | null;
}

export interface Room {
  id: number;
  name: string;
  capacity: number | null;
  note: string | null;
  class_count?: number;
}

export const classesApi = {
  list: (search = '', page?: PageParams, teacherId?: number) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (teacherId) q.set('teacher_id', String(teacherId));
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<ClassItem>>(qs ? `/classes?${qs}` : '/classes');
  },
  get: (id: number | string) => http.get<ClassDetail>(`/classes/${id}`),
  create: (form: ClassForm) => http.post<ClassItem>('/classes', form),
  update: (id: number | string, form: ClassForm) => http.put<ClassItem>(`/classes/${id}`, form),
  remove: (id: number | string) => http.del<{ ok: boolean }>(`/classes/${id}`),
  enroll: (classId: number | string, studentId: number) =>
    http.post<{ ok: boolean }>(`/classes/${classId}/enroll`, { student_id: studentId }),
  unenroll: (enrollmentId: number | string) =>
    http.del<{ ok: boolean }>(`/classes/enrollments/${enrollmentId}`),
};

export const sessionsApi = {
  listByClass: (classId: number | string) => http.get<SessionItem[]>(`/classes/${classId}/sessions`),
  create: (classId: number | string, date: string, topic: string) =>
    http.post<SessionItem>('/sessions', { class_id: classId, date, topic }),
  updateTopic: (sessionId: number | string, topic: string) =>
    http.put<{ ok: boolean }>(`/sessions/${sessionId}`, { topic }),
  getAttendance: (sessionId: number | string) =>
    http.get<{ session: SessionItem; students: AttendanceRow[] }>(`/sessions/${sessionId}/attendance`),
  saveAttendance: (
    sessionId: number | string,
    records: { student_id: number; status: string; note?: string }[]
  ) => http.post<{ saved: number }>(`/sessions/${sessionId}/attendance`, { records }),
  generateCheckinCode: (sessionId: number | string) =>
    http.post<{ code: string }>(`/sessions/${sessionId}/checkin-code`),
};

export const roomsApi = {
  list: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<Room>>(qs ? `/rooms?${qs}` : '/rooms');
  },
  create: (form: { name: string; capacity?: number | null; note?: string }) =>
    http.post<Room>('/rooms', form),
  update: (id: number | string, form: { name: string; capacity?: number | null; note?: string }) =>
    http.put<Room>(`/rooms/${id}`, form),
  remove: (id: number | string) => http.del<{ ok: boolean }>(`/rooms/${id}`),
};
