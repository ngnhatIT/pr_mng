/**
 * API layer cho feature Bài tập về nhà.
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import { HomeworkItem } from '../../shared/types';
import { ClassItem } from '../classes/classes.api';

export interface HomeworkForm {
  class_ids: number[];
  title: string;
  content: string | null;
  due_date: string | null;
  status?: 'draft' | 'scheduled' | 'published';
  publish_at?: string | null;
  max_score?: number | null;
  close_date?: string | null;
  kind?: 'homework' | 'quiz';
  rubric_id?: number | null;
  attachments?: { name: string; url: string; kind: string }[];
  target_student_ids?: number[];
  questions?: QuizQuestionForm[];
}

export interface QuizQuestionForm {
  question: string;
  points: number;
  options: { text: string; is_correct: boolean }[];
}

export interface QuizQuestionEdit {
  id: number;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean }[];
}

export interface Rubric {
  id: number;
  name: string;
  criteria: { id: number; name: string; max_score: number }[];
  total_score: number;
}

export interface HomeworkScoreRow {
  student_id: number;
  student_name: string;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  completed: number;
  quiz_score: number | null;
}

export interface QuizAttemptRow {
  id: number;
  student_id: number;
  student_name: string;
  score: number;
  max_score: number;
  submitted_at: string;
}

export interface HomeworkStats {
  total: number;
  dueSoon: number;
  overdue: number;
  drafts: number;
}

export interface HomeworkFilters {
  class_id?: string;
  search?: string;
  due?: '' | 'upcoming' | 'overdue' | 'nodate';
  status?: '' | 'draft' | 'scheduled' | 'published';
  kind?: '' | 'homework' | 'quiz';
}

export interface HomeworkCreateResult {
  created: HomeworkItem[];
  count: number;
}

export const homeworkApi = {
  list: (filters: HomeworkFilters = {}, page?: PageParams) => {
    const q = new URLSearchParams();
    if (filters.class_id) q.set('class_id', filters.class_id);
    if (filters.search) q.set('search', filters.search);
    if (filters.due) q.set('due', filters.due);
    if (filters.status) q.set('status', filters.status);
    if (filters.kind) q.set('kind', filters.kind);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<HomeworkItem>>(`/homework?${q.toString()}`);
  },
  stats: () => http.get<HomeworkStats>('/homework/stats'),
  get: (id: number) => http.get<HomeworkItem>(`/homework/${id}`),
  create: (form: HomeworkForm) => http.post<HomeworkCreateResult>('/homework', form),
  update: (id: number, form: Omit<HomeworkForm, 'class_ids'>) =>
    http.put<HomeworkItem>(`/homework/${id}`, form),
  remove: (id: number) => http.del<{ ok: boolean }>(`/homework/${id}`),
  reuse: (id: number) => http.post<{ created: HomeworkItem; count: number }>(`/homework/${id}/reuse`),
  publish: (id: number) => http.post<{ ok: boolean }>(`/homework/${id}/publish`),
  unpublish: (id: number) => http.post<{ ok: boolean }>(`/homework/${id}/unpublish`),
  listClasses: () => http.get<Paginated<ClassItem>>('/classes?limit=100').then((r) => r.data),
  // Điểm số
  getScores: (id: number) => http.get<HomeworkScoreRow[]>(`/homework/${id}/scores`),
  grade: (id: number, studentId: number, score: number | null, feedback: string) =>
    http.post<{ ok: boolean }>(`/homework/${id}/scores`, { student_id: studentId, score, feedback }),
  // Quiz
  getQuizEdit: (id: number) => http.get<QuizQuestionEdit[]>(`/homework/${id}/quiz/edit`),
  saveQuiz: (id: number, questions: QuizQuestionForm[]) =>
    http.put<{ ok: boolean; count: number }>(`/homework/${id}/quiz`, { questions }),
  getQuizAttempts: (id: number) => http.get<QuizAttemptRow[]>(`/homework/${id}/quiz/attempts`),
  // Rubric
  listRubrics: () => http.get<Rubric[]>('/homework/rubrics/list'),
  createRubric: (name: string, criteria: { name: string; max_score: number }[]) =>
    http.post<Rubric>('/homework/rubrics/list', { name, criteria }),
  deleteRubric: (id: number) => http.del<{ ok: boolean }>(`/homework/rubrics/${id}`),
  // Analytics
  analytics: () => http.get<HomeworkAnalytics>('/homework/analytics'),
  // Question bank
  bankList: (search = '', tag = '', page = 1, limit = 50) =>
    http.get<{
      data: BankQuestion[];
      tags: string[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(
      `/homework/bank/questions?search=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}&page=${page}&limit=${limit}`
    ),
  bankCreate: (q: BankQuestionForm) => http.post<BankQuestion>('/homework/bank/questions', q),
  bankUpdate: (id: number, q: BankQuestionForm) =>
    http.put<BankQuestion>(`/homework/bank/questions/${id}`, q),
  bankDelete: (id: number) => http.del<{ ok: boolean }>(`/homework/bank/questions/${id}`),
  bankImport: (homeworkId: number, bankIds: number[]) =>
    http.post<{ ok: boolean; count: number }>(`/homework/${homeworkId}/quiz/import`, { bank_ids: bankIds }),
  // Submissions (staff)
  getSubmissions: (id: number, page = 1, limit = 50) =>
    http.get<{
      data: Submission[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/homework/${id}/submissions?page=${page}&limit=${limit}`),
};

export interface HomeworkAnalytics {
  byClass: {
    class_id: number;
    class_name: string;
    total: number;
    avg_completion: number;
    avg_score: number | null;
  }[];
  recent: { id: number; title: string; class_name: string; completion_rate: number }[];
}

export interface BankQuestion {
  id: number;
  tag: string | null;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean }[];
}

export interface BankQuestionForm {
  tag?: string | null;
  question: string;
  points: number;
  options: { text: string; is_correct: boolean }[];
}

export interface Submission {
  id: number;
  homework_id: number;
  student_id: number;
  student_name: string;
  file_url: string | null;
  file_name: string | null;
  note: string | null;
  submitted_at: string;
}
