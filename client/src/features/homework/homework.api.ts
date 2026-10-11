/**
 * API layer cho feature Bài tập về nhà.
 */
import {
  http,
  getToken,
  tryRefresh,
  withActingCenter,
  type Paginated,
  type PageParams,
} from '../../shared/api/client';
import i18n from '../../i18n';
import { HomeworkItem } from '../../shared/types';
import { ClassItem } from '../classes/classes.api';
import { fetchAllPages } from '../../shared/components/Pagination';

/** Định dạng file giáo viên được tải lên (khớp ALLOWED_EXT của server). */
export const UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.mp3,.mp4,.doc,.docx';
/** Giới hạn dung lượng client check trước khi gửi (server check lại ở trust boundary). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Kết quả upload file đính kèm từ POST /api/v1/uploads. */
export interface UploadedFile {
  url: string;
  name: string;
  size: number;
}

/** Thông báo lỗi upload theo ngôn ngữ đang chọn (namespace homework). */
const tUpload = (key: string) => i18n.t(`form.errors.${key}`, { ns: 'homework' });

/** 1 lần gửi XHR. Reject Error mang message của server (400/413) hoặc lỗi mạng, kèm `status`. */
function sendUpload(file: File, onProgress: (pct: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1' + withActingCenter('/uploads'));
    xhr.timeout = 60_000;
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedFile);
        } catch {
          reject(new Error(tUpload('attBadResponse')));
        }
        return;
      }
      let msg = tUpload('attUploadFailed');
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error || msg;
      } catch {
        /* giữ message mặc định */
      }
      reject(Object.assign(new Error(msg), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error(tUpload('attNetwork')));
    xhr.ontimeout = () => reject(new Error(tUpload('attTimeout')));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

/**
 * Upload file qua XMLHttpRequest để có tiến trình % (fetch không báo progress).
 * Access token hết hạn (401) → refresh 1 lần rồi gửi lại (giống api()).
 */
export async function uploadFile(file: File, onProgress: (pct: number) => void): Promise<UploadedFile> {
  try {
    return await sendUpload(file, onProgress);
  } catch (err) {
    if ((err as { status?: number }).status === 401 && (await tryRefresh())) {
      onProgress(0);
      return sendUpload(file, onProgress);
    }
    throw err;
  }
}

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
  /** Quiz: số lượt làm tối đa (null = không giới hạn) */
  max_attempts?: number | null;
  attachments?: { name: string; url: string; kind: string }[];
  target_student_ids?: number[];
  questions?: QuizQuestionForm[];
}

export type QType = 'single' | 'multiple' | 'truefalse' | 'essay';

/** 2 đáp án trống (đáp án đầu đúng) cho câu trắc nghiệm mới — dùng chung builder quiz + ngân hàng câu hỏi. */
export const blankOptions = () => [
  { text: '', is_correct: true },
  { text: '', is_correct: false },
];

export interface QuizQuestionForm {
  question: string;
  points: number;
  qtype?: QType;
  options: { text: string; is_correct: boolean }[];
}

export interface QuizQuestionEdit {
  id: number;
  qtype: 'single' | 'multiple' | 'truefalse' | 'essay';
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

/** YC2: câu essay + rubric của quiz (để màn chấm hiện/ẩn nút chấm tự luận). */
export interface QuizEssayInfo {
  essay_questions: { question_id: number; question: string; points: number }[];
  rubric: Rubric | null;
}

/** YC2: dữ liệu form chấm tự luận của 1 học viên. */
export interface EssayGradingData {
  rubric: Rubric;
  questions: {
    question_id: number;
    question: string;
    points: number;
    answer_text: string | null;
    submitted_at: string | null;
    scores: { criterion_id: number; score: number }[];
  }[];
  auto_score: number;
  total_score: number | null;
  feedback: string | null;
}

export interface EssayGradeResult {
  ok: boolean;
  total: number;
  auto_score: number;
  essay_score: number;
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
  listClasses: () =>
    fetchAllPages((p) => http.get<Paginated<ClassItem>>(`/classes?page=${p.page}&limit=${p.limit}`)),
  // Điểm số
  getScores: (id: number) => http.get<HomeworkScoreRow[]>(`/homework/${id}/scores`),
  grade: (id: number, studentId: number, score: number | null, feedback: string) =>
    http.post<{ ok: boolean }>(`/homework/${id}/scores`, { student_id: studentId, score, feedback }),
  // Upload file đính kèm (giáo viên)
  uploadFile,
  /** Xóa file đã upload nhưng chưa gắn vào bài nào (dọn file mồ côi). */
  deleteUpload: (filename: string) => http.del<{ ok: boolean }>(`/uploads/${filename}`),
  // Quiz
  getQuizEdit: (id: number) => http.get<QuizQuestionEdit[]>(`/homework/${id}/quiz/edit`),
  saveQuiz: (id: number, questions: QuizQuestionForm[]) =>
    http.put<{ ok: boolean; count: number }>(`/homework/${id}/quiz`, { questions }),
  getQuizAttempts: (id: number) => http.get<QuizAttemptRow[]>(`/homework/${id}/quiz/attempts`),
  // YC2: chấm tự luận quiz theo rubric
  getQuizEssayInfo: (id: number) => http.get<QuizEssayInfo>(`/homework/${id}/quiz/essay`),
  getEssayGrading: (id: number, studentId: number) =>
    http.get<EssayGradingData>(`/homework/${id}/quiz/essay/${studentId}`),
  gradeQuizEssay: (
    id: number,
    studentId: number,
    questionId: number,
    criteria: { criterion_id: number; score: number }[],
    feedback: string
  ) =>
    http.post<EssayGradeResult>(`/homework/${id}/quiz/essay/grade`, {
      student_id: studentId,
      question_id: questionId,
      criteria,
      feedback,
    }),
  // Rubric
  listRubrics: () => http.get<Rubric[]>('/homework/rubrics/list'),
  createRubric: (name: string, criteria: { name: string; max_score: number }[]) =>
    http.post<Rubric>('/homework/rubrics/list', { name, criteria }),
  deleteRubric: (id: number) => http.del<{ ok: boolean }>(`/homework/rubrics/${id}`),
  // Analytics
  analytics: () => http.get<HomeworkAnalytics>('/homework/analytics'),
  // Question bank
  bankList: (search = '', tag = '', page = 1, limit = 50, subject = '', difficulty = '') => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (tag) q.set('tag', tag);
    if (subject) q.set('subject', subject);
    if (difficulty) q.set('difficulty', difficulty);
    q.set('page', String(page));
    q.set('limit', String(limit));
    return http.get<{
      data: BankQuestion[];
      tags: string[];
      subjects: string[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/homework/bank/questions?${q.toString()}`);
  },
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
  subject: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  qtype: 'single' | 'multiple' | 'truefalse' | 'essay';
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean }[];
}

export interface BankQuestionForm {
  tag?: string | null;
  subject?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard';
  qtype?: 'single' | 'multiple' | 'truefalse' | 'essay';
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
