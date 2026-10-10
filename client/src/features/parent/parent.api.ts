/**
 * API layer cho feature Cổng phụ huynh.
 */
import { http } from '../../shared/api/client';
import {
  ParentUser,
  ParentChild,
  ChildOverview,
  LeaveRequest,
  ReferralItem,
  CreditSummary,
} from '../../shared/types';

export interface VietQRInfo {
  qr_url: string;
  amount: number;
  addInfo: string;
  bank: string;
  account_no: string;
  account_name: string;
}

export interface ReferralData {
  referral_code: string;
  share_link: string;
  stats: { total: number; pending: number; rewarded: number };
  credits: CreditSummary;
  referrals: ReferralItem[];
}

export interface LeaveForm {
  student_id: number;
  class_id: number | null;
  from_date: string;
  to_date: string;
  reason: string | null;
}

export const parentApi = {
  login: (phone: string, password: string) =>
    http.post<{ token: string; parent: ParentUser }>('/parent/login', {
      phone,
      password,
    }),
  register: (phone: string, password: string, name: string, center_id: number) =>
    http.post<{ token: string; parent: ParentUser }>('/parent/register', {
      phone,
      password,
      name,
      center_id,
    }),

  children: () => http.get<ParentChild[]>('/parent/children'),
  /** H5: trạng thái + bật/tắt đồng ý nhận tin Zalo ZNS */
  consent: () => http.get<{ zalo_consent: string }>('/parent/consent'),
  setConsent: (consent: 'granted' | 'denied') =>
    http.put<{ ok: boolean; zalo_consent: string }>('/parent/consent', { consent }),
  linkChild: (studentCode: string, dob: string) =>
    http.post<{ ok: boolean; student: ParentChild }>('/parent/link', { student_code: studentCode, dob }),
  childOverview: (id: number | string) => http.get<ChildOverview>(`/parent/children/${id}/overview`),

  vietqr: (invoiceId: number) => http.get<VietQRInfo>(`/parent/invoices/${invoiceId}/vietqr`),
  vnpay: (invoiceId: number) => http.post<{ pay_url: string }>(`/parent/invoices/${invoiceId}/vnpay`),
  claimPaid: (invoiceId: number) =>
    http.post<{ ok: boolean; payment_id: number }>(`/parent/invoices/${invoiceId}/claim-paid`),

  leaves: () => http.get<LeaveRequest[]>('/parent/leaves'),
  createLeave: (form: LeaveForm) => http.post<LeaveRequest>('/parent/leaves', form),

  referral: () => http.get<ReferralData>('/parent/referral'),

  markHomeworkDone: (homeworkId: number, studentId: number) =>
    http.post<{ ok: boolean }>(`/parent/homework/${homeworkId}/complete`, { student_id: studentId }),
  unmarkHomeworkDone: (homeworkId: number, studentId: number) =>
    http.del<{ ok: boolean }>(`/parent/homework/${homeworkId}/complete?student_id=${studentId}`),
  getQuiz: (homeworkId: number, studentId: number) =>
    http.get<QuizQuestion[]>(`/parent/homework/${homeworkId}/quiz?student_id=${studentId}`),
  submitQuiz: (
    homeworkId: number,
    studentId: number,
    answers: { question_id: number; option_id?: number | null; option_ids?: number[]; answer_text?: string | null }[]
  ) =>
    http.post<{ score: number; max_score: number; attempt_id: number; attempt_no: number }>(
      `/parent/homework/${homeworkId}/quiz/submit`,
      {
        student_id: studentId,
        answers,
      }
    ),
  getQuizAttempts: (homeworkId: number, studentId: number) =>
    http.get<QuizAttempt[]>(`/parent/homework/${homeworkId}/quiz/attempts?student_id=${studentId}`),
  getAttemptReview: (attemptId: number, studentId: number) =>
    http.get<QuizAttemptDetail[]>(`/parent/quiz/attempts/${attemptId}/review?student_id=${studentId}`),
  submitHomework: (homeworkId: number, studentId: number, file: File | null, note: string) => {
    const fd = new FormData();
    fd.append('student_id', String(studentId));
    if (file) fd.append('file', file);
    if (note) fd.append('note', note);
    return http.postForm<{ ok: boolean }>(`/parent/homework/${homeworkId}/submit`, fd);
  },
  getSubmissions: (homeworkId: number, studentId: number) =>
    http.get<Submission[]>(`/parent/homework/${homeworkId}/submissions?student_id=${studentId}`),
};

export interface Submission {
  id: number;
  homework_id: number;
  student_id: number;
  file_url: string | null;
  file_name: string | null;
  note: string | null;
  submitted_at: string;
}

export interface QuizQuestion {
  id: number;
  qtype: 'single' | 'multiple' | 'truefalse' | 'essay';
  question: string;
  points: number;
  options: { id: number; text: string }[];
}

export interface QuizAttempt {
  id: number;
  score: number;
  max_score: number;
  submitted_at: string;
  answers: {
    question_id: number;
    option_ids: number[];
    answer_text: string | null;
    correct: boolean | null;
  }[];
}

export interface QuizAttemptDetail {
  question_id: number;
  question: string;
  qtype: 'single' | 'multiple' | 'truefalse' | 'essay';
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
  answer_text: string | null;
  correct: boolean | null;
  /** YC2: điểm chấm tay câu essay (null = chưa chấm). */
  essay_score: number | null;
}

export interface QuizAttemptDetail {
  question_id: number;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}
