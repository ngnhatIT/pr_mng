import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { todayVN } from './homework.helpers';
import { eventBus } from '../../shared/events/eventBus';
import { QuizSubmittedEvent } from '../../shared/events/homework.events';

/* ---------------------------------- Types ---------------------------------- */

export interface QuizOptionInput {
  text: string;
  is_correct: boolean;
}

export interface QuizQuestionInput {
  question: string;
  points: number;
  options: QuizOptionInput[];
}

export interface QuizQuestion {
  id: number;
  question: string;
  points: number;
  options: { id: number; text: string }[]; // ẩn is_correct với học viên
}

export interface QuizAttempt {
  id: number;
  score: number;
  max_score: number;
  submitted_at: string;
  answers: { question_id: number; option_id: number | null; correct: boolean }[];
}

/* --------------------------------- Service --------------------------------- */

/** Lưu bộ câu hỏi cho quiz (thay thế toàn bộ). Validate TẤT CẢ trước khi xóa để tránh mất dữ liệu. */
export function saveQuizQuestions(homeworkId: number, questions: QuizQuestionInput[]): void {
  // Chặn sửa đề khi đã có học viên làm bài (tránh hỏng lịch sử)
  if (countQuizAttempts(homeworkId) > 0) {
    throw AppError.badRequest('Đã có học viên làm bài, không thể sửa đề. Hãy tạo quiz mới.');
  }
  if (!questions.length) throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');
  // Validate toàn bộ trước — không xóa gì nếu có lỗi
  questions.forEach((q, qi) => {
    if (!q.question.trim()) throw AppError.badRequest(`Câu ${qi + 1} chưa có nội dung`);
    if (q.options.length < 2) throw AppError.badRequest(`Câu ${qi + 1} cần ít nhất 2 đáp án`);
    if (!q.options.some((o) => o.is_correct))
      throw AppError.badRequest(`Câu ${qi + 1} chưa chọn đáp án đúng`);
    const texts = q.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length)
      throw AppError.badRequest(`Câu ${qi + 1} có đáp án trùng nhau`);
    q.options.forEach((o, oi) => {
      if (!o.text.trim()) throw AppError.badRequest(`Câu ${qi + 1}: đáp án ${oi + 1} trống`);
    });
  });

  // Tất cả hợp lệ → thay thế trong transaction
  const tx = db.transaction(() => {
    const qids = db
      .prepare('SELECT id FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId) as { id: number }[];
    for (const q of qids) db.prepare('DELETE FROM quiz_options WHERE question_id = ?').run(q.id);
    db.prepare('DELETE FROM quiz_questions WHERE homework_id = ?').run(homeworkId);

    const qStmt = db.prepare(
      'INSERT INTO quiz_questions (homework_id, position, question, points) VALUES (?, ?, ?, ?)'
    );
    const oStmt = db.prepare(
      'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    questions.forEach((q, qi) => {
      const qr = qStmt.run(homeworkId, qi, q.question.trim(), Math.max(0.5, Number(q.points) || 1));
      const qid = Number(qr.lastInsertRowid);
      q.options.forEach((o, oi) => {
        oStmt.run(qid, oi, o.text.trim(), o.is_correct ? 1 : 0);
      });
    });
  });
  tx();
}

/** Lấy câu hỏi cho học viên làm bài (ẩn đáp án đúng). */
export function getQuizForStudent(homeworkId: number): QuizQuestion[] {
  const qs = db
    .prepare(
      'SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id'
    )
    .all(homeworkId) as { id: number; question: string; points: number }[];
  return qs.map((q) => ({
    ...q,
    options: db
      .prepare('SELECT id, text FROM quiz_options WHERE question_id = ? ORDER BY position, id')
      .all(q.id) as { id: number; text: string }[],
  }));
}

/** Đếm số câu hỏi của quiz. */
export function countQuizQuestions(homeworkId: number): number {
  return (db.prepare('SELECT COUNT(*) as c FROM quiz_questions WHERE homework_id = ?').get(homeworkId) as { c: number }).c;
}

/** Lấy đề quiz đầy đủ kèm đáp án đúng (chỉ staff — để sửa đề). */
export function getQuizForStaff(homeworkId: number): (QuizQuestion & { options: { id: number; text: string; is_correct: boolean }[] })[] {
  const qs = db
    .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(homeworkId) as { id: number; question: string; points: number }[];
  return qs.map((q) => ({
    ...q,
    options: db
      .prepare('SELECT id, text, is_correct FROM quiz_options WHERE question_id = ? ORDER BY position, id')
      .all(q.id) as { id: number; text: string; is_correct: boolean }[],
  }));
}

/** Đếm số lượt làm của quiz (để chặn sửa đề khi đã có người làm). */
export function countQuizAttempts(homeworkId: number): number {
  return (db.prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ?').get(homeworkId) as { c: number }).c;
}

/**
 * Nộp bài quiz → tự chấm điểm ngay (Classroom: Forms grade importing).
 * - Cho làm lại nhiều lần (như Google Forms), giữ điểm CAO NHẤT
 * - Không ghi đè điểm giáo viên đã chấm tay (trừ khi điểm tự chấm cao hơn và giáo viên chưa chấm)
 * Trả về điểm đạt được.
 */
export function submitQuiz(
  homeworkId: number,
  studentId: number,
  answers: { question_id: number; option_id: number }[]
): { score: number; max_score: number; attempt_id: number; attempt_no: number } {
  // Kiểm tra hạn chót cứng
  const hw = db.prepare('SELECT close_date FROM homework WHERE id = ?').get(homeworkId) as
    | { close_date: string | null }
    | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const today = todayVN();
  if (hw.close_date && hw.close_date < today) {
    throw AppError.badRequest('Đã quá hạn chót, không thể nộp bài');
  }

  const answerMap = new Map(answers.map((a) => [a.question_id, a.option_id]));
  const questions = db
    .prepare('SELECT id, points FROM quiz_questions WHERE homework_id = ?')
    .all(homeworkId) as { id: number; points: number }[];
  if (questions.length === 0) throw AppError.badRequest('Quiz chưa có câu hỏi');

  let score = 0;
  let maxScore = 0;
  const graded: { question_id: number; option_id: number | null; correct: boolean }[] = [];
  for (const q of questions) {
    maxScore += q.points;
    const optId = answerMap.get(q.id) ?? null;
    const opt = optId
      ? (db.prepare('SELECT is_correct FROM quiz_options WHERE id = ? AND question_id = ?').get(optId, q.id) as { is_correct: number } | undefined)
      : undefined;
    const correct = !!opt && opt.is_correct === 1;
    if (correct) score += q.points;
    graded.push({ question_id: q.id, option_id: optId, correct });
  }

  const attemptNo = (
    db
      .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ? AND student_id = ?')
      .get(homeworkId, studentId) as { c: number }
  ).c + 1;

  const tx = db.transaction(() => {
    const ar = db
      .prepare('INSERT INTO quiz_attempts (homework_id, student_id, score, max_score) VALUES (?, ?, ?, ?)')
      .run(homeworkId, studentId, score, maxScore);
    const attemptId = Number(ar.lastInsertRowid);
    const aStmt = db.prepare(
      'INSERT INTO quiz_answers (attempt_id, question_id, option_id) VALUES (?, ?, ?)'
    );
    for (const g of graded) aStmt.run(attemptId, g.question_id, g.option_id);

    // Đồng bộ điểm: giữ điểm CAO NHẤT; không ghi đè điểm giáo viên chấm tay
    const existing = db
      .prepare('SELECT score, graded_by FROM homework_scores WHERE homework_id = ? AND student_id = ?')
      .get(homeworkId, studentId) as { score: number | null; graded_by: number | null } | undefined;
    const teacherGraded = existing && existing.graded_by !== null;
    const bestScore = Math.max(score, existing?.score ?? 0);
    if (!teacherGraded) {
      db.prepare(
        `INSERT INTO homework_scores (homework_id, student_id, score, graded_at, graded_by)
         VALUES (?, ?, ?, datetime('now'), NULL)
         ON CONFLICT(homework_id, student_id) DO UPDATE SET score = ?, graded_at = datetime('now')`
      ).run(homeworkId, studentId, bestScore, bestScore);
    }

    // Đánh dấu hoàn thành
    db.prepare(
      `INSERT INTO homework_completions (homework_id, student_id, completed_by)
       VALUES (?, ?, 'student')
       ON CONFLICT(homework_id, student_id) DO NOTHING`
    ).run(homeworkId, studentId);

    return attemptId;
  });
  const attemptId = tx();

  eventBus.emitSync(new QuizSubmittedEvent(homeworkId, studentId, attemptId, score, maxScore));
  return { score, max_score: maxScore, attempt_id: attemptId, attempt_no: attemptNo };
}

/** Lịch sử làm bài của học viên. */
export function getStudentAttempts(homeworkId: number, studentId: number): QuizAttempt[] {
  const attempts = db
    .prepare(
      'SELECT id, score, max_score, submitted_at FROM quiz_attempts WHERE homework_id = ? AND student_id = ? ORDER BY submitted_at DESC'
    )
    .all(homeworkId, studentId) as QuizAttempt[];
  return attempts.map((a) => ({
    ...a,
    answers: db
      .prepare(
        `SELECT qa.question_id, qa.option_id,
          CASE WHEN qo.is_correct = 1 THEN 1 ELSE 0 END as correct
         FROM quiz_answers qa LEFT JOIN quiz_options qo ON qo.id = qa.option_id
         WHERE qa.attempt_id = ?`
      )
      .all(a.id) as { question_id: number; option_id: number | null; correct: boolean }[],
  }));
}

/** Staff xem tất cả lượt làm bài của 1 quiz. */
export function getAllAttempts(homeworkId: number): unknown[] {
  return db
    .prepare(
      `SELECT qa.id, qa.student_id, s.name as student_name, qa.score, qa.max_score, qa.submitted_at
       FROM quiz_attempts qa JOIN students s ON s.id = qa.student_id
       WHERE qa.homework_id = ? ORDER BY qa.submitted_at DESC`
    )
    .all(homeworkId);
}

/* ------------------------------- Chấm lại ------------------------------- */

export interface QuizReview {
  question_id: number;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}

/** Chi tiết 1 lượt làm: câu hỏi + đáp án đúng/sai + đáp án đã chọn (Google Forms: review). */
export function getAttemptReview(attemptId: number, studentId: number): QuizReview[] {
  const attempt = db
    .prepare('SELECT homework_id, student_id FROM quiz_attempts WHERE id = ?')
    .get(attemptId) as { homework_id: number; student_id: number } | undefined;
  if (!attempt || attempt.student_id !== studentId) throw AppError.notFound('Không tìm thấy lượt làm bài');
  const chosen = new Map(
    (db.prepare('SELECT question_id, option_id FROM quiz_answers WHERE attempt_id = ?').all(attemptId) as { question_id: number; option_id: number | null }[])
      .map((a) => [a.question_id, a.option_id])
  );
  const qs = db
    .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(attempt.homework_id) as { id: number; question: string; points: number }[];
  return qs.map((q) => ({
    question_id: q.id,
    question: q.question,
    points: q.points,
    options: (db.prepare('SELECT id, text, is_correct FROM quiz_options WHERE question_id = ? ORDER BY position, id').all(q.id) as { id: number; text: string; is_correct: number }[])
      .map((o) => ({
        id: o.id,
        text: o.text,
        is_correct: o.is_correct === 1,
        chosen: chosen.get(q.id) === o.id,
      })),
  }));
}
