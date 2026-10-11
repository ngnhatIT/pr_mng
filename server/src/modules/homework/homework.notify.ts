import { db } from '../../db';
import { notifyHomeworkPublished as sendZalo } from '../../services/zalo';

export interface HomeworkNotifyInfo {
  id: number;
  title: string;
  class_name: string;
  due_date: string | null;
  student_count: number;
  center_id: number | null;
}

/** Lấy thông tin bài tập để gửi thông báo (1 query chuẩn). */
export async function getHomeworkNotifyInfo(homeworkId: number): Promise<HomeworkNotifyInfo | null> {
  const row = (await db
    .prepare(
      `SELECT h.id, h.title, c.name as class_name, h.due_date, COALESCE(h.center_id, c.center_id) as center_id,
        (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = h.class_id AND e.status = 'active') as student_count
       FROM homework h JOIN classes c ON c.id = h.class_id
       WHERE h.id = ?`
    )
    .get(homeworkId)) as HomeworkNotifyInfo | undefined;
  return row ?? null;
}

/**
 * Thông báo bài tập mới/phát hành tới phụ huynh (Zalo).
 * Không bao giờ throw — thông báo không được làm hỏng nghiệp vụ chính.
 */
export async function notifyHomework(centerId: number | null, homeworkId: number): Promise<void> {
  try {
    const info = await getHomeworkNotifyInfo(homeworkId);
    if (!info) return;
    // C-5: superadmin không truyền ?center_id -> centerId null; lấy trung tâm của chính bài tập
    await sendZalo(
      info.center_id ?? centerId,
      { id: info.id, title: info.title, class_name: info.class_name, due_date: info.due_date },
      info.student_count
    );
  } catch {
    /* bỏ qua */
  }
}
