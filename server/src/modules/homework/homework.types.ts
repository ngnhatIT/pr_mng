/** Kiểu dữ liệu + hằng của module Homework (B3-3: tách khỏi homework.service.ts, re-export ở đó). */

/* ---------------------------------- Types ---------------------------------- */

/** Trạng thái bài tập — dùng const thay vì string literal rải rác (chống typo). */
export const HOMEWORK_STATUS = ['draft', 'scheduled', 'published'] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUS)[number];

/** Loại bài tập. */
export const HOMEWORK_KIND = ['homework', 'quiz'] as const;
export type HomeworkKind = (typeof HOMEWORK_KIND)[number];

/** Ai đánh dấu hoàn thành. */
export type CompletedBy = 'parent' | 'teacher' | 'student';

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface HomeworkRow {
  id: number;
  class_id: number;
  class_name?: string;
  center_id: number | null;
  title: string;
  content: string | null;
  due_date: string | null;
  created_at: string;
  status: HomeworkStatus;
  publish_at: string | null;
  max_score: number | null;
  close_date: string | null;
  kind: HomeworkKind;
  rubric_id: number | null;
  max_attempts: number | null;
  completed_count?: number;
  student_count?: number;
  question_count?: number;
  attachments?: { id: number; name: string; url: string; kind: string }[];
  [key: string]: unknown;
}

export interface HomeworkQuery {
  class_id?: string;
  search?: string;
  due?: '' | 'upcoming' | 'overdue' | 'nodate';
  status?: '' | 'draft' | 'scheduled' | 'published';
  kind?: '' | 'homework' | 'quiz';
}

export interface CreateHomeworkInput {
  class_ids: number[];
  title: string;
  content?: string | null;
  due_date?: string | null;
  created_by: number;
  centerId: number | null;
  status?: string;
  publish_at?: string | null;
  max_score?: number | null;
  close_date?: string | null;
  kind?: string;
  rubric_id?: number | null;
  max_attempts?: number | null;
  attachments?: { name: string; url: string; kind: string }[];
  target_student_ids?: number[];
}
