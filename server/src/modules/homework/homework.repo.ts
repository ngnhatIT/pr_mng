import { db } from '../../db';
import type { HomeworkRow, HomeworkStatus } from './homework.service';

/**
 * Repository: lớp truy cập dữ liệu thuần cho homework.
 * - Chỉ chứa SQL, không có logic nghiệp vụ
 * - Service gọi repository, không viết SQL trực tiếp
 * - Dễ mock trong test, dễ đổi DB sau này
 */
export const homeworkRepo = {
  /** Tìm bài tập theo id. */
  async findById(id: number): Promise<HomeworkRow | null> {
    const row = (await db.prepare('SELECT * FROM homework WHERE id = ?').get(id)) as HomeworkRow | undefined;
    return row ?? null;
  },

  /** Bài tập kèm thông tin scope của lớp (để kiểm tra quyền). */
  async findWithScope(
    id: number
  ): Promise<(HomeworkRow & { class_center_id: number | null; teacher_id: number | null }) | null> {
    const row = (await db
      .prepare(
        `SELECT h.*, c.center_id as class_center_id, c.teacher_id
         FROM homework h JOIN classes c ON c.id = h.class_id
         WHERE h.id = ?`
      )
      .get(id)) as (HomeworkRow & { class_center_id: number | null; teacher_id: number | null }) | undefined;
    return row ?? null;
  },

  /** Đếm bài tập của 1 lớp (để chặn xóa lớp). */
  async countByClass(classId: number): Promise<number> {
    return (
      (await db.prepare('SELECT COUNT(*) as c FROM homework WHERE class_id = ?').get(classId)) as {
        c: number;
      }
    ).c;
  },

  /** Insert bài tập, trả về id. */
  async insert(data: {
    center_id: number | null;
    class_id: number;
    title: string;
    content: string | null;
    due_date: string | null;
    created_by: number | null;
    status: HomeworkStatus;
    publish_at: string | null;
    max_score: number | null;
    close_date: string | null;
    kind: string;
    rubric_id: number | null;
  }): Promise<number> {
    const r = await db
      .prepare(
        `INSERT INTO homework (center_id, class_id, title, content, due_date, created_by,
          status, publish_at, max_score, close_date, kind, rubric_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.center_id,
        data.class_id,
        data.title,
        data.content,
        data.due_date,
        data.created_by,
        data.status,
        data.publish_at,
        data.max_score,
        data.close_date,
        data.kind,
        data.rubric_id
      );
    return Number(r.lastInsertRowid);
  },

  /** Cập nhật các field cho phép sửa. */
  async update(
    id: number,
    patch: Partial<
      Pick<
        HomeworkRow,
        | 'title'
        | 'content'
        | 'due_date'
        | 'max_score'
        | 'close_date'
        | 'status'
        | 'publish_at'
        | 'kind'
        | 'rubric_id'
      >
    >
  ): Promise<void> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    const set = keys.map((k) => `${k} = ?`).join(', ');
    await db.prepare(`UPDATE homework SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
  },

  /** Đặt trạng thái đăng/gỡ đăng. */
  async setStatus(id: number, status: 'published' | 'draft'): Promise<void> {
    await db.prepare('UPDATE homework SET status = ?, publish_at = NULL WHERE id = ?').run(status, id);
  },

  /** Các bài hẹn giờ đã đến hạn (chưa publish). */
  async findDueScheduled(now: string): Promise<{ id: number; center_id: number | null }[]> {
    return (await db
      .prepare("SELECT id, center_id FROM homework WHERE status = 'scheduled' AND publish_at <= ?")
      .all(now)) as { id: number; center_id: number | null }[];
  },

  /** Publish tất cả bài hẹn giờ đến hạn, trả về số bài. */
  async publishDue(now: string): Promise<number> {
    const r = await db
      .prepare("UPDATE homework SET status = 'published' WHERE status = 'scheduled' AND publish_at <= ?")
      .run(now);
    return Number(r.changes);
  },

  /** Xóa bài tập và toàn bộ dữ liệu liên quan (cascade trong transaction). */
  async deleteCascade(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .prepare(
          'DELETE FROM quiz_answers WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE homework_id = ?)'
        )
        .run(id);
      await tx.prepare('DELETE FROM quiz_attempts WHERE homework_id = ?').run(id);
      await tx
        .prepare(
          'DELETE FROM quiz_options WHERE question_id IN (SELECT id FROM quiz_questions WHERE homework_id = ?)'
        )
        .run(id);
      await tx.prepare('DELETE FROM quiz_questions WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework_scores WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework_completions WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework_attachments WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework_targets WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework_submissions WHERE homework_id = ?').run(id);
      await tx.prepare('DELETE FROM homework WHERE id = ?').run(id);
    });
  },
};
