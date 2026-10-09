import { db } from '../../db';
import { notifyHomeworkPublished as sendZalo } from '../../services/zalo';

export interface HomeworkNotifyInfo {
  id: number;
  title: string;
  class_name: string;
  due_date: string | null;
  student_count: number;
}

/** Lấy thông tin bài tập để gửi thông báo (1 query chuẩn). */
export function getHomeworkNotifyInfo(homeworkId: number): HomeworkNotifyInfo | null {
  const row = db
    .prepare(
      `SELECT h.id, h.title, c.name as class_name, h.due_date,
        (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = h.class_id AND e.status = 'active') as student_count
       FROM homework h JOIN classes c ON c.id = h.class_id
       WHERE h.id = ?`
    )
    .get(homeworkId) as
    | { id: number; title: string; class_name: string; due_date: string | null; student_count: number }
    | undefined;
  return row ?? null;
}

/**
 * Thông báo bài tập mới/phát hành tới phụ huynh (Zalo).
 * Không bao giờ throw — thông báo không được làm hỏng nghiệp vụ chính.
 */
export function notifyHomework(
  centerId: number | null,
  homeworkId: number
): void {
  try {
    const info = getHomeworkNotifyInfo(homeworkId);
    if (!info) return;
    sendZalo(
      centerId,
      { id: info.id, title: info.title, class_name: info.class_name, due_date: info.due_date },
      info.student_count
    );
  } catch {
    /* bỏ qua */
  }
}
