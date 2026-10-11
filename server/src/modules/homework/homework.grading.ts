/**
 * Chấm điểm bài tập thường, bảng điểm, phân tích (B3-3: tách khỏi homework.service.ts, re-export ở đó).
 */
import { db } from '../../db';
import type { ScopeCtx } from '../../shared/scope';
import { AppError } from '../../shared/errors';
import { eventBus } from '../../shared/events/eventBus';
import { HomeworkGradedEvent } from '../../shared/events/homework.events';
import { assignedCountExpr, scopeConds } from './homework.helpers';

/* --------------------------------- Chấm điểm --------------------------------- */

/**
 * Học viên phải đang học lớp của bài tập (hoặc nằm trong danh sách giao riêng)
 * mới được chấm điểm — chống điểm "mồ côi". Dùng chung cho chấm tay bài thường
 * (gradeHomework) và chấm tự luận quiz (gradeQuizEssay trong quiz.service).
 */
export async function assertGradableStudent(
  homeworkId: number,
  classId: number,
  studentId: number
): Promise<void> {
  const enrolled = await db
    .prepare(`SELECT 1 FROM enrollments WHERE student_id = ? AND class_id = ? AND status = 'active'`)
    .get(studentId, classId);
  if (!enrolled) {
    const targeted = await db
      .prepare('SELECT 1 FROM homework_targets WHERE homework_id = ? AND student_id = ?')
      .get(homeworkId, studentId);
    if (!targeted) throw AppError.badRequest('Học viên không thuộc lớp của bài tập này');
  }
}

/** Chấm điểm bài tập thường (tay hoặc theo rubric).
 * - Bọc transaction: điểm + đánh dấu hoàn thành là 1 đơn vị nguyên tử.
 * - Kiểm tra học viên thuộc lớp của bài tập (chống điểm "mồ côi"). */
export async function gradeHomework(
  homeworkId: number,
  studentId: number,
  score: number | null,
  feedback: string | null,
  gradedBy: number | null
): Promise<void> {
  const hw = (await db.prepare('SELECT class_id, max_score FROM homework WHERE id = ?').get(homeworkId)) as
    { class_id: number; max_score: number | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  // Chặn điểm vượt quá điểm tối đa (gõ nhầm 15/10)
  if (score !== null) {
    if (score < 0) throw AppError.badRequest('Điểm không được âm');
    if (hw.max_score != null && score > hw.max_score) {
      throw AppError.badRequest(`Điểm không được vượt quá ${hw.max_score}`);
    }
  }
  await assertGradableStudent(homeworkId, hw.class_id, studentId);
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO homework_scores (homework_id, student_id, score, feedback, graded_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(homework_id, student_id)
       DO UPDATE SET score = ?, feedback = ?, graded_at = datetime('now'), graded_by = ?`
      )
      .run(homeworkId, studentId, score, feedback, gradedBy, score, feedback, gradedBy);
    if (score !== null) {
      await tx
        .prepare(
          `INSERT INTO homework_completions (homework_id, student_id, completed_by)
         VALUES (?, ?, 'teacher') ON CONFLICT(homework_id, student_id) DO NOTHING`
        )
        .run(homeworkId, studentId);
    }
  });
  eventBus.emitSync(new HomeworkGradedEvent(homeworkId, studentId, score, gradedBy));
}

/** Bảng điểm của 1 bài tập: từng học viên + điểm + trạng thái. */
export interface HomeworkScoreRow {
  student_id: number;
  student_name: string;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  completed: number;
  quiz_score: number | null;
}

export async function getHomeworkScores(homeworkId: number): Promise<HomeworkScoreRow[]> {
  return (await db
    .prepare(
      `SELECT s.id as student_id, s.name as student_name,
        hs.score, hs.feedback, hs.graded_at,
        CASE WHEN hc.id IS NOT NULL THEN 1 ELSE 0 END as completed,
        (SELECT score FROM quiz_attempts qa
         WHERE qa.homework_id = ? AND qa.student_id = s.id
         ORDER BY qa.submitted_at DESC LIMIT 1) as quiz_score
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       LEFT JOIN homework_scores hs ON hs.homework_id = ? AND hs.student_id = s.id
       LEFT JOIN homework_completions hc ON hc.homework_id = ? AND hc.student_id = s.id
       WHERE e.class_id = (SELECT class_id FROM homework WHERE id = ?)
         AND e.status = 'active'
         AND (NOT EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ?)
              OR EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ? AND ht.student_id = s.id))
       ORDER BY s.name`
    )
    .all(homeworkId, homeworkId, homeworkId, homeworkId, homeworkId, homeworkId)) as HomeworkScoreRow[];
}

/** Điểm của 1 học viên cho 1 bài (parent view). */
export async function getStudentScore(
  homeworkId: number,
  studentId: number
): Promise<{ score: number | null; feedback: string | null; max_score: number | null } | null> {
  const hw = (await db.prepare('SELECT max_score FROM homework WHERE id = ?').get(homeworkId)) as
    { max_score: number | null } | undefined;
  if (!hw) return null;
  const s = (await db
    .prepare('SELECT score, feedback FROM homework_scores WHERE homework_id = ? AND student_id = ?')
    .get(homeworkId, studentId)) as { score: number | null; feedback: string | null } | undefined;
  return { score: s?.score ?? null, feedback: s?.feedback ?? null, max_score: hw.max_score };
}

/* --------------------------------- Analytics --------------------------------- */

/** Phân tích tổng quan bài tập: hoàn thành, điểm TB theo lớp. */
export async function getHomeworkAnalytics(ctx: ScopeCtx): Promise<{
  byClass: {
    class_id: number;
    class_name: string;
    total: number;
    avg_completion: number;
    avg_score: number | null;
  }[];
  recent: { id: number; title: string; class_name: string; completion_rate: number }[];
}> {
  const params: unknown[] = [];
  const conds = scopeConds(ctx, params);
  const from = `FROM homework h JOIN classes c ON c.id = h.class_id`;
  const where = `WHERE ${conds.join(' AND ')} AND h.status = 'published'`;

  // Mẫu số: số học viên được giao (target riêng) hoặc cả lớp
  const denominator = assignedCountExpr('h', 'h');

  const byClass = (await db
    .prepare(
      `SELECT c.id as class_id, c.name as class_name,
        COUNT(DISTINCT h.id) as total,
        COALESCE(AVG(
          (SELECT COUNT(*) FROM homework_completions hc WHERE hc.homework_id = h.id) * 1.0 /
          NULLIF(${denominator}, 0)
        ), 0) as avg_completion,
        (SELECT AVG(hs.score) FROM homework_scores hs
         JOIN homework h2 ON h2.id = hs.homework_id
         WHERE h2.class_id = c.id AND hs.score IS NOT NULL) as avg_score
       ${from} ${where} GROUP BY c.id, c.name ORDER BY c.name`
    )
    .all(...params)) as {
    class_id: number;
    class_name: string;
    total: number;
    avg_completion: number;
    avg_score: number | null;
  }[];

  const recent = (await db
    .prepare(
      `SELECT h.id, h.title, c.name as class_name,
        COALESCE(
          (SELECT COUNT(*) FROM homework_completions hc WHERE hc.homework_id = h.id) * 100.0 /
          NULLIF(${denominator}, 0), 0
        ) as completion_rate
       ${from} ${where} ORDER BY h.id DESC LIMIT 10`
    )
    .all(...params)) as { id: number; title: string; class_name: string; completion_rate: number }[];

  return { byClass, recent };
}
