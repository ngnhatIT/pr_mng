import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { todayVN } from '../../shared/vnTime';
import { eventBus } from '../../shared/events/eventBus';
import { QuizSubmittedEvent } from '../../shared/events/homework.events';
import { sumQuestionPoints, normalizePoints, normalizeQtype, validateQuestionOptions, gradeQuestion, type QuestionType } from './homework.helpers';

/* ---------------------------------- Types ---------------------------------- */

export interface QuizOptionInput {
  text: string;
  is_correct: boolean;
}

export interface QuizQuestionInput {
  question: string;
  points: number;
  qtype?: string;
  options: QuizOptionInput[];
}

/** Câu hỏi đã validate + chuẩn hoá (validateQuizQuestions trả về). */
export interface NormalizedQuizQuestion {
  question: string;
  points: number;
  qtype: QuestionType;
  options: { text: string; is_correct: boolean }[];
}

export interface QuizQuestion {
  id: number;
  qtype: string;
  question: string;
  points: number;
  options: { id: number; text: string }[]; // ẩn is_correct với học viên
}

/** Bài làm 1 câu: tương thích shape cũ {question_id, option_id};
 * multiple → option_ids (nhiều đáp án); essay → answer_text (tự luận). */
export interface QuizAnswerInput {
  question_id: number;
  option_id?: number | null;
  option_ids?: number[];
  answer_text?: string | null;
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
    correct: boolean | null; // null = essay chờ chấm
  }[];
}

/* --------------------------------- Service --------------------------------- */

/**
 * Validate bộ câu hỏi quiz (dùng chung cho tạo mới và lưu đề): ném AppError
 * nếu câu hỏi/đáp án không hợp lệ. Không chạm DB — gọi trước mọi ghi dữ liệu.
 * Trả về bộ câu hỏi đã chuẩn hoá (qtype, options) để caller ghi DB trực tiếp.
 */
export function validateQuizQuestions(questions: QuizQuestionInput[]): NormalizedQuizQuestion[] {
  if (!Array.isArray(questions) || !questions.length)
    throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');
  return questions.map((q, qi) => {
    const label = `Câu ${qi + 1}`;
    if (typeof q?.question !== 'string' || !q.question.trim())
      throw AppError.badRequest(`${label} chưa có nội dung`);
    const qtype = normalizeQtype(q?.qtype, `${label} (loại câu hỏi)`);
    const options = validateQuestionOptions(qtype, q?.options, label);
    // P1-7: điểm âm/khổng lồ/không phải số → 400, không clamp im lặng
    const points = normalizePoints(q?.points, `Điểm câu ${qi + 1}`);
    return { question: q.question.trim(), points, qtype, options };
  });
}

/** Lưu bộ câu hỏi cho quiz (thay thế toàn bộ). Validate TẤT CẢ trước khi xóa để tránh mất dữ liệu. */
export async function saveQuizQuestions(homeworkId: number, questions: QuizQuestionInput[]): Promise<void> {
  // Validate toàn bộ trước — không xóa gì nếu có lỗi (không cần lock)
  const normalized = validateQuizQuestions(questions);

  // Tất cả hợp lệ → thay thế trong transaction
  await db.transaction(async (tx) => {
    // P1-13: lock row homework để serialize với importFromBank/submitQuiz —
    // check attempts + xóa + ghi là 1 đơn vị nguyên tử, hết race TOCTOU
    await tx.prepare('SELECT id FROM homework WHERE id = ? FOR UPDATE').get(homeworkId);
    // Chặn sửa đề khi đã có học viên làm bài (tránh hỏng lịch sử)
    const attempts = (
      (await tx
        .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ?')
        .get(homeworkId)) as { c: number }
    ).c;
    if (attempts > 0) {
      throw AppError.badRequest('Đã có học viên làm bài, không thể sửa đề. Hãy tạo quiz mới.');
    }
    const qids = (await tx
      .prepare('SELECT id FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId)) as { id: number }[];
    for (const q of qids) await tx.prepare('DELETE FROM quiz_options WHERE question_id = ?').run(q.id);
    await tx.prepare('DELETE FROM quiz_questions WHERE homework_id = ?').run(homeworkId);

    const qStmt = await tx.prepare(
      'INSERT INTO quiz_questions (homework_id, position, qtype, question, points) VALUES (?, ?, ?, ?, ?)'
    );
    const oStmt = await tx.prepare(
      'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    for (const [qi, q] of normalized.entries()) {
      const qr = await qStmt.run(homeworkId, qi, q.qtype, q.question, q.points);
      const qid = Number(qr.lastInsertRowid);
      // essay: không có đáp án trắc nghiệm
      for (const [oi, o] of q.options.entries()) {
        await oStmt.run(qid, oi, o.text, o.is_correct ? 1 : 0);
      }
    }
    // Đồng bộ max_score của bài theo đề mới (giữ điểm lẻ 0.5, không làm tròn)
    await tx
      .prepare('UPDATE homework SET max_score = ? WHERE id = ?')
      .run(sumQuestionPoints(normalized), homeworkId);
  });
}

/** Lấy câu hỏi cho học viên làm bài (ẩn đáp án đúng). */
export async function getQuizForStudent(homeworkId: number): Promise<QuizQuestion[]> {
  const qs = (await db
    .prepare('SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(homeworkId)) as { id: number; qtype: string; question: string; points: number }[];
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
    .prepare('SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(homeworkId)) as { id: number; qtype: string; question: string; points: number }[];
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
 * Chuẩn hoá bài làm ở trust boundary: shape cũ {question_id, option_id} vẫn
 * được chấp nhận (1 đáp án); multiple dùng option_ids; essay dùng answer_text.
 * Giá trị rác (id không phải số, text quá dài) → 400, không để 500 ở DB.
 */
function normalizeSubmitAnswers(
  answers: QuizAnswerInput[] | undefined | null
): Map<number, { optionIds: number[]; answerText: string | null }> {
  if (!Array.isArray(answers)) throw AppError.badRequest('Bài làm không hợp lệ');
  const map = new Map<number, { optionIds: number[]; answerText: string | null }>();
  for (const a of answers) {
    if (typeof a !== 'object' || a === null || !Number.isInteger(a.question_id)) {
      throw AppError.badRequest('Bài làm không hợp lệ');
    }
    const optionIds = new Set<number>();
    // Tương thích shape cũ: option_id đơn
    if (a.option_id !== undefined && a.option_id !== null) {
      if (!Number.isInteger(a.option_id)) throw AppError.badRequest('Bài làm không hợp lệ');
      optionIds.add(a.option_id);
    }
    if (a.option_ids !== undefined && a.option_ids !== null) {
      if (!Array.isArray(a.option_ids) || a.option_ids.some((id) => !Number.isInteger(id))) {
        throw AppError.badRequest('Bài làm không hợp lệ');
      }
      for (const id of a.option_ids) optionIds.add(id);
    }
    let answerText: string | null = null;
    if (a.answer_text !== undefined && a.answer_text !== null) {
      if (typeof a.answer_text !== 'string') throw AppError.badRequest('Bài làm không hợp lệ');
      answerText = a.answer_text.trim().slice(0, 20000) || null;
    }
    map.set(a.question_id, { optionIds: [...optionIds], answerText });
  }
  return map;
}

/**
 * Nộp bài quiz → tự chấm điểm ngay (Classroom: Forms grade importing).
 * Quy tắc chấm theo loại câu (xem gradeQuestion trong homework.helpers):
 * single/truefalse khớp đáp án đúng → full điểm; multiple khớp TOÀN BỘ
 * (đúng hết đáp án đúng, không chọn đáp án sai) → full điểm, ngược lại 0
 * (không cho điểm từng phần); essay không chấm tự động (0 điểm tạm, chờ
 * giáo viên chấm tay qua gradeHomework).
 * - Cho làm lại nhiều lần (như Google Forms), giữ điểm CAO NHẤT
 * - Không ghi đè điểm giáo viên đã chấm tay (trừ khi điểm tự chấm cao hơn và giáo viên chưa chấm)
 * Trả về điểm đạt được.
 */
export async function submitQuiz(
  homeworkId: number,
  studentId: number,
  answers: QuizAnswerInput[]
): Promise<{ score: number; max_score: number; attempt_id: number; attempt_no: number }> {
  // Kiểm tra hạn chót cứng
  const hw = (await db.prepare('SELECT close_date FROM homework WHERE id = ?').get(homeworkId)) as
    { close_date: string | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const today = todayVN();
  if (hw.close_date && hw.close_date < today) {
    throw AppError.badRequest('Đã quá hạn chót, không thể nộp bài');
  }

  const answerMap = normalizeSubmitAnswers(answers);
  const questions = (await db
    .prepare('SELECT id, qtype, points FROM quiz_questions WHERE homework_id = ?')
    .all(homeworkId)) as { id: number; qtype: string; points: number }[];
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
  const optionsByQuestion = new Map<number, { id: number; is_correct: number }[]>();
  for (const o of options) {
    const list = optionsByQuestion.get(o.question_id) ?? [];
    list.push({ id: o.id, is_correct: o.is_correct });
    optionsByQuestion.set(o.question_id, list);
  }

  let score = 0;
  let maxScore = 0;
  // Bài làm đã chuẩn hoá để ghi quiz_answers: mỗi câu multiple → 1 dòng/đáp án
  // đã chọn; essay → 1 dòng chứa answer_text; single/truefalse → 1 dòng.
  const rowsToInsert: { question_id: number; option_id: number | null; answer_text: string | null }[] = [];
  for (const q of questions) {
    maxScore += q.points;
    const qtype = normalizeQtype(q.qtype);
    const given = answerMap.get(q.id) ?? { optionIds: [], answerText: null };
    // Lọc đáp án lạ (id không thuộc câu này) — coi như không chọn, không 500
    const validIds = new Set((optionsByQuestion.get(q.id) ?? []).map((o) => o.id));
    const chosen = given.optionIds.filter((id) => validIds.has(id));
    const correctIds = (optionsByQuestion.get(q.id) ?? [])
      .filter((o) => o.is_correct === 1)
      .map((o) => o.id);
    if (gradeQuestion(qtype, chosen, correctIds) === true) score += q.points;
    // essay: chấm tay sau — điểm tự động 0, lưu nội dung bài làm
    if (qtype === 'essay') {
      rowsToInsert.push({ question_id: q.id, option_id: null, answer_text: given.answerText });
    } else if (chosen.length) {
      for (const oid of chosen) rowsToInsert.push({ question_id: q.id, option_id: oid, answer_text: null });
    } else {
      rowsToInsert.push({ question_id: q.id, option_id: null, answer_text: null }); // bỏ trống
    }
  }

  const attemptNo =
    (
      (await db
        .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ? AND student_id = ?')
        .get(homeworkId, studentId)) as { c: number }
    ).c + 1;

  const attemptId = await db.transaction(async (tx) => {
    // P1-13: lock row homework để serialize các lần nộp đồng thời cùng bài
    await tx.prepare('SELECT id FROM homework WHERE id = ? FOR UPDATE').get(homeworkId);
    const ar = await tx
      .prepare('INSERT INTO quiz_attempts (homework_id, student_id, score, max_score) VALUES (?, ?, ?, ?)')
      .run(homeworkId, studentId, score, maxScore);
    const attemptId = Number(ar.lastInsertRowid);
    const aStmt = await tx.prepare(
      'INSERT INTO quiz_answers (attempt_id, question_id, option_id, answer_text) VALUES (?, ?, ?, ?)'
    );
    for (const r of rowsToInsert) await aStmt.run(attemptId, r.question_id, r.option_id, r.answer_text);

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
  // Gom bài làm theo (lượt, câu hỏi): multiple có thể chọn nhiều đáp án (nhiều
  // dòng), essay lưu answer_text. Chấm lại trong memory để có correct theo qtype.
  const answersByAttempt = new Map<
    number,
    { question_id: number; option_ids: number[]; answer_text: string | null; correct: boolean | null }[]
  >();
  if (attempts.length) {
    const rows = (await db
      .prepare(
        `SELECT qa.attempt_id, qa.question_id, qa.option_id, qa.answer_text
         FROM quiz_answers qa
         WHERE qa.attempt_id IN (${attempts.map(() => '?').join(',')})`
      )
      .all(...attempts.map((a) => a.id))) as {
      attempt_id: number;
      question_id: number;
      option_id: number | null;
      answer_text: string | null;
    }[];
    const qtypes = new Map(
      (
        (await db
          .prepare('SELECT id, qtype FROM quiz_questions WHERE homework_id = ?')
          .all(homeworkId)) as { id: number; qtype: string }[]
      ).map((q) => [q.id, normalizeQtype(q.qtype)])
    );
    const options = await getOptionsBatch([...qtypes.keys()]);
    const correctIdsByQ = new Map<number, number[]>();
    for (const [qid, opts] of options) {
      correctIdsByQ.set(
        qid,
        opts.filter((o) => o.is_correct === 1).map((o) => o.id)
      );
    }
    const grouped = new Map<string, { attempt_id: number; question_id: number; option_ids: number[]; answer_text: string | null }>();
    for (const r of rows) {
      const key = `${r.attempt_id}:${r.question_id}`;
      let g = grouped.get(key);
      if (!g) {
        g = { attempt_id: r.attempt_id, question_id: r.question_id, option_ids: [], answer_text: null };
        grouped.set(key, g);
      }
      if (r.option_id !== null && r.option_id !== undefined) g.option_ids.push(r.option_id);
      if (r.answer_text) g.answer_text = r.answer_text;
    }
    for (const g of grouped.values()) {
      const qtype = qtypes.get(g.question_id) ?? 'single';
      const correct = gradeQuestion(qtype, g.option_ids, correctIdsByQ.get(g.question_id) ?? []);
      const list = answersByAttempt.get(g.attempt_id) ?? [];
      list.push({ question_id: g.question_id, option_ids: g.option_ids, answer_text: g.answer_text, correct });
      answersByAttempt.set(g.attempt_id, list);
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
  qtype: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
  answer_text: string | null; // bài làm tự luận (câu essay)
  correct: boolean | null; // null = essay, chờ chấm tay
}

/** Chi tiết 1 lượt làm: câu hỏi + đáp án đúng/sai + đáp án đã chọn (Google Forms: review).
 * Câu essay hiện nội dung bài làm + trạng thái "chờ chấm" (correct = null). */
export async function getAttemptReview(attemptId: number, studentId: number): Promise<QuizReview[]> {
  const attempt = (await db
    .prepare('SELECT homework_id, student_id FROM quiz_attempts WHERE id = ?')
    .get(attemptId)) as { homework_id: number; student_id: number } | undefined;
  if (!attempt || attempt.student_id !== studentId) throw AppError.notFound('Không tìm thấy lượt làm bài');
  // Gom đáp án đã chọn theo câu hỏi (multiple = nhiều dòng; essay = answer_text)
  const chosenByQ = new Map<number, { option_ids: number[]; answer_text: string | null }>();
  for (const a of (await db
    .prepare('SELECT question_id, option_id, answer_text FROM quiz_answers WHERE attempt_id = ?')
    .all(attemptId)) as { question_id: number; option_id: number | null; answer_text: string | null }[]) {
    let g = chosenByQ.get(a.question_id);
    if (!g) {
      g = { option_ids: [], answer_text: null };
      chosenByQ.set(a.question_id, g);
    }
    if (a.option_id !== null && a.option_id !== undefined) g.option_ids.push(a.option_id);
    if (a.answer_text) g.answer_text = a.answer_text;
  }
  const qs = (await db
    .prepare('SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id')
    .all(attempt.homework_id)) as { id: number; qtype: string; question: string; points: number }[];
  // P1-4: 1 query duy nhất cho mọi đáp án thay vì 1 query/câu hỏi
  const options = await getOptionsBatch(qs.map((q) => q.id));
  return qs.map((q) => {
    const qtype = normalizeQtype(q.qtype);
    const given = chosenByQ.get(q.id) ?? { option_ids: [], answer_text: null };
    const opts = options.get(q.id) ?? [];
    const correctIds = opts.filter((o) => o.is_correct === 1).map((o) => o.id);
    return {
      question_id: q.id,
      question: q.question,
      qtype,
      points: q.points,
      options: opts.map((o) => ({
        id: o.id,
        text: o.text,
        is_correct: o.is_correct === 1,
        chosen: given.option_ids.includes(o.id),
      })),
      answer_text: given.answer_text,
      correct: gradeQuestion(qtype, given.option_ids, correctIds),
    };
  });
}
