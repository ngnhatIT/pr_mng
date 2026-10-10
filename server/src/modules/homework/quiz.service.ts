import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { todayVN } from '../../shared/vnTime';
import { eventBus } from '../../shared/events/eventBus';
import { QuizSubmittedEvent } from '../../shared/events/homework.events';
import { sumQuestionPoints, normalizePoints, assertUniqueOptionTexts } from './homework.helpers';

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

/**
 * Validate bộ câu hỏi quiz (dùng chung cho tạo mới và lưu đề): ném AppError
 * nếu câu hỏi/đáp án không hợp lệ. Không chạm DB — gọi trước mọi ghi dữ liệu.
 */
export function validateQuizQuestions(questions: QuizQuestionInput[]): void {
  if (!Array.isArray(questions) || !questions.length)
    throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');
  questions.forEach((q, qi) => {
    if (typeof q?.question !== 'string' || !q.question.trim())
      throw AppError.badRequest(`Câu ${qi + 1} chưa có nội dung`);
    if (!Array.isArray(q.options) || q.options.length < 2)
      throw AppError.badRequest(`Câu ${qi + 1} cần ít nhất 2 đáp án`);
    if (!q.options.some((o) => o.is_correct))
      throw AppError.badRequest(`Câu ${qi + 1} chưa chọn đáp án đúng`);
    // P1-7: điểm âm/khổng lồ/không phải số → 400, không clamp im lặng
    normalizePoints(q?.points, `Điểm câu ${qi + 1}`);
    assertUniqueOptionTexts(q.options, `Câu ${qi + 1} có đáp án trùng nhau`);
    q.options.forEach((o, oi) => {
      if (typeof o.text !== 'string' || !o.text.trim())
        throw AppError.badRequest(`Câu ${qi + 1}: đáp án ${oi + 1} trống`);
    });
  });
}

/** Lưu bộ câu hỏi cho quiz (thay thế toàn bộ). Validate TẤT CẢ trước khi xóa để tránh mất dữ liệu. */
export async function saveQuizQuestions(homeworkId: number, questions: QuizQuestionInput[]): Promise<void> {
  // Chặn sửa đề khi đã có học viên làm bài (tránh hỏng lịch sử)
  if ((await countQuizAttempts(homeworkId)) > 0) {
    throw AppError.badRequest('Đã có học viên làm bài, không thể sửa đề. Hãy tạo quiz mới.');
  }
  // Validate toàn bộ trước — không xóa gì nếu có lỗi
  validateQuizQuestions(questions);

  // Tất cả hợp lệ → thay thế trong transaction
  await db.transaction(async (tx) => {
    const qids = (await tx
      .prepare('SELECT id FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId)) as { id: number }[];
    for (const q of qids) await tx.prepare('DELETE FROM quiz_options WHERE question_id = ?').run(q.id);
    await tx.prepare('DELETE FROM quiz_questions WHERE homework_id = ?').run(homeworkId);

    const qStmt = await tx.prepare(
      'INSERT INTO quiz_questions (homework_id, position, question, points) VALUES (?, ?, ?, ?)'
    );
    const oStmt = await tx.prepare(
      'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    for (const [qi, q] of questions.entries()) {
      // Điểm đã validate ở validateQuizQuestions — normalizePoints không clamp im lặng
      const qr = await qStmt.run(homeworkId, qi, q.question.trim(), normalizePoints(q.points));
      const qid = Number(qr.lastInsertRowid);
      for (const [oi, o] of q.options.entries()) {
        await oStmt.run(qid, oi, o.text.trim(), o.is_correct ? 1 : 0);
      }
    }
    // Đồng bộ max_score của bài theo đề mới (giữ điểm lẻ 0.5, không làm tròn)
    await tx
      .prepare('UPDATE homework SET max_score = ? WHERE id = ?')
      .run(sumQuestionPoints(questions), homeworkId);
  });
}

/** Lấy câu hỏi cho học viên làm bài (ẩn đáp án đúng). */
export async function getQuizForStudent(homeworkId: number): Promise<QuizQuestion[]> {
  const qs = (await db
    .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(homeworkId)) as { id: number; question: string; points: number }[];
  // P1-4: 1 query duy nhất cho mọi đáp án thay vì 1 query/câu hỏi.
  // Học viên KHÔNG bao giờ thấy is_correct — strip ở đây, không phụ thuộc caller.
  const options = await getOptionsBatch(qs.map((q) => q.id));
  return qs.map((q) => ({
    ...q,
    options: (options.get(q.id) ?? []).map((o) => ({ id: o.id, text: o.text })),
  }));
}

/**
 * Tải đáp án của nhiều câu hỏi trong 1 query, gom theo question_id (chống N+1).
 * Luôn lấy is_correct để staff dùng; caller tự strip khi trả cho học viên.
 */
async function getOptionsBatch(
  questionIds: number[]
): Promise<Map<number, { id: number; text: string; is_correct: number }[]>> {
  const map = new Map<number, { id: number; text: string; is_correct: number }[]>();
  if (!questionIds.length) return map;
  const rows = (await db
    .prepare(
      `SELECT id, question_id, text, is_correct FROM quiz_options WHERE question_id IN (${questionIds
        .map(() => '?')
        .join(',')}) ORDER BY question_id, position, id`
    )
    .all(...questionIds)) as { id: number; question_id: number; text: string; is_correct: number }[];
  for (const r of rows) {
    const list = map.get(r.question_id) ?? [];
    list.push({ id: r.id, text: r.text, is_correct: r.is_correct });
    map.set(r.question_id, list);
  }
  return map;
}

/** Đếm số câu hỏi của quiz. */
export async function countQuizQuestions(homeworkId: number): Promise<number> {
  return (
    (await db.prepare('SELECT COUNT(*) as c FROM quiz_questions WHERE homework_id = ?').get(homeworkId)) as {
      c: number;
    }
  ).c;
}

/** Lấy đề quiz đầy đủ kèm đáp án đúng (chỉ staff — để sửa đề). */
export async function getQuizForStaff(
  homeworkId: number
): Promise<(QuizQuestion & { options: { id: number; text: string; is_correct: boolean }[] })[]> {
  const qs = (await db
    .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(homeworkId)) as { id: number; question: string; points: number }[];
  // P1-4: 1 query duy nhất cho mọi đáp án thay vì 1 query/câu hỏi
  const options = await getOptionsBatch(qs.map((q) => q.id));
  return qs.map((q) => ({
    ...q,
    options: (options.get(q.id) ?? []).map((o) => ({
      id: o.id,
      text: o.text,
      is_correct: o.is_correct === 1,
    })),
  }));
}

/** Đếm số lượt làm của quiz (để chặn sửa đề khi đã có người làm). */
export async function countQuizAttempts(homeworkId: number): Promise<number> {
  return (
    (await db.prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ?').get(homeworkId)) as {
      c: number;
    }
  ).c;
}

/**
 * Nộp bài quiz → tự chấm điểm ngay (Classroom: Forms grade importing).
 * - Cho làm lại nhiều lần (như Google Forms), giữ điểm CAO NHẤT
 * - Không ghi đè điểm giáo viên đã chấm tay (trừ khi điểm tự chấm cao hơn và giáo viên chưa chấm)
 * Trả về điểm đạt được.
 */
export async function submitQuiz(
  homeworkId: number,
  studentId: number,
  answers: { question_id: number; option_id: number }[]
): Promise<{ score: number; max_score: number; attempt_id: number; attempt_no: number }> {
  // Kiểm tra hạn chót cứng
  const hw = (await db.prepare('SELECT close_date FROM homework WHERE id = ?').get(homeworkId)) as
    { close_date: string | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const today = todayVN();
  if (hw.close_date && hw.close_date < today) {
    throw AppError.badRequest('Đã quá hạn chót, không thể nộp bài');
  }

  const answerMap = new Map(answers.map((a) => [a.question_id, a.option_id]));
  const questions = (await db
    .prepare('SELECT id, points FROM quiz_questions WHERE homework_id = ?')
    .all(homeworkId)) as { id: number; points: number }[];
  if (questions.length === 0) throw AppError.badRequest('Quiz chưa có câu hỏi');

  // Chấm 40 câu = 1 query duy nhất thay vì 40 round-trip (hết N+1):
  // tải toàn bộ đáp án đúng của quiz trước, chấm trong memory.
  // Giữ đúng semantics cũ: đáp án phải đúng VÀ thuộc đúng câu hỏi
  // (đáp án của câu khác, dù đúng, vẫn bị chấm sai).
  const options = (await db
    .prepare(
      `SELECT id, question_id, is_correct FROM quiz_options WHERE question_id IN (${questions
        .map(() => '?')
        .join(',')})`
    )
    .all(...questions.map((q) => q.id))) as { id: number; question_id: number; is_correct: number }[];
  const optionMap = new Map(options.map((o) => [o.id, o]));

  let score = 0;
  let maxScore = 0;
  const graded: { question_id: number; option_id: number | null; correct: boolean }[] = [];
  for (const q of questions) {
    maxScore += q.points;
    const optId = answerMap.get(q.id) ?? null;
    const opt = optId ? optionMap.get(optId) : undefined;
    const correct = !!opt && opt.question_id === q.id && opt.is_correct === 1;
    if (correct) score += q.points;
    graded.push({ question_id: q.id, option_id: optId, correct });
  }

  const attemptNo =
    (
      (await db
        .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ? AND student_id = ?')
        .get(homeworkId, studentId)) as { c: number }
    ).c + 1;

  const attemptId = await db.transaction(async (tx) => {
    const ar = await tx
      .prepare('INSERT INTO quiz_attempts (homework_id, student_id, score, max_score) VALUES (?, ?, ?, ?)')
      .run(homeworkId, studentId, score, maxScore);
    const attemptId = Number(ar.lastInsertRowid);
    const aStmt = await tx.prepare(
      'INSERT INTO quiz_answers (attempt_id, question_id, option_id) VALUES (?, ?, ?)'
    );
    for (const g of graded) await aStmt.run(attemptId, g.question_id, g.option_id);

    // Đồng bộ điểm: giữ điểm CAO NHẤT — atomic bằng GREATEST ngay trong SQL,
    // không đọc-then-ghi từ snapshot nên 2 lần nộp đồng thời không ghi đè
    // điểm cao bằng điểm thấp (lost-update); không chạm điểm giáo viên chấm tay.
    await tx
      .prepare(
        `INSERT INTO homework_scores (homework_id, student_id, score, graded_at, graded_by)
         VALUES (?, ?, ?, datetime('now'), NULL)
         ON CONFLICT(homework_id, student_id) DO UPDATE SET
           score = GREATEST(homework_scores.score, excluded.score),
           graded_at = datetime('now')
         WHERE homework_scores.graded_by IS NULL`
      )
      .run(homeworkId, studentId, score);

    // Đánh dấu hoàn thành
    await tx
      .prepare(
        `INSERT INTO homework_completions (homework_id, student_id, completed_by)
       VALUES (?, ?, 'student')
       ON CONFLICT(homework_id, student_id) DO NOTHING`
      )
      .run(homeworkId, studentId);

    return attemptId;
  });

  eventBus.emitSync(new QuizSubmittedEvent(homeworkId, studentId, attemptId, score, maxScore));
  return { score, max_score: maxScore, attempt_id: attemptId, attempt_no: attemptNo };
}

/** Lịch sử làm bài của học viên. */
export async function getStudentAttempts(homeworkId: number, studentId: number): Promise<QuizAttempt[]> {
  const attempts = (await db
    .prepare(
      'SELECT id, score, max_score, submitted_at FROM quiz_attempts WHERE homework_id = ? AND student_id = ? ORDER BY submitted_at DESC'
    )
    .all(homeworkId, studentId)) as QuizAttempt[];
  // P1-4: 1 query duy nhất cho đáp án mọi lượt làm thay vì 1 query/lượt
  const answersByAttempt = new Map<number, { question_id: number; option_id: number | null; correct: boolean }[]>();
  if (attempts.length) {
    const rows = (await db
      .prepare(
        `SELECT qa.attempt_id, qa.question_id, qa.option_id,
          CASE WHEN qo.is_correct = 1 THEN 1 ELSE 0 END as correct
         FROM quiz_answers qa LEFT JOIN quiz_options qo ON qo.id = qa.option_id
         WHERE qa.attempt_id IN (${attempts.map(() => '?').join(',')})`
      )
      .all(...attempts.map((a) => a.id))) as {
      attempt_id: number;
      question_id: number;
      option_id: number | null;
      correct: boolean;
    }[];
    for (const r of rows) {
      const list = answersByAttempt.get(r.attempt_id) ?? [];
      list.push({ question_id: r.question_id, option_id: r.option_id, correct: r.correct });
      answersByAttempt.set(r.attempt_id, list);
    }
  }
  return attempts.map((a) => ({ ...a, answers: answersByAttempt.get(a.id) ?? [] }));
}

/** Staff xem tất cả lượt làm bài của 1 quiz. */
export async function getAllAttempts(homeworkId: number): Promise<unknown[]> {
  return await db
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
export async function getAttemptReview(attemptId: number, studentId: number): Promise<QuizReview[]> {
  const attempt = (await db
    .prepare('SELECT homework_id, student_id FROM quiz_attempts WHERE id = ?')
    .get(attemptId)) as { homework_id: number; student_id: number } | undefined;
  if (!attempt || attempt.student_id !== studentId) throw AppError.notFound('Không tìm thấy lượt làm bài');
  const chosen = new Map(
    (
      (await db
        .prepare('SELECT question_id, option_id FROM quiz_answers WHERE attempt_id = ?')
        .all(attemptId)) as { question_id: number; option_id: number | null }[]
    ).map((a) => [a.question_id, a.option_id])
  );
  const qs = (await db
    .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(attempt.homework_id)) as { id: number; question: string; points: number }[];
  // P1-4: 1 query duy nhất cho mọi đáp án thay vì 1 query/câu hỏi
  const options = await getOptionsBatch(qs.map((q) => q.id));
  return qs.map((q) => ({
    question_id: q.id,
    question: q.question,
    points: q.points,
    options: (options.get(q.id) ?? []).map((o) => ({
      id: o.id,
      text: o.text,
      is_correct: o.is_correct === 1,
      chosen: chosen.get(q.id) === o.id,
    })),
  }));
}
