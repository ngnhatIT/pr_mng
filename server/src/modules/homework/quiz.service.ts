import { db } from '../../db';
import type { Tx } from '../../db';
import { AppError } from '../../shared/errors';
import { todayVN } from '../../shared/vnTime';
import { eventBus } from '../../shared/events/eventBus';
import { QuizSubmittedEvent, HomeworkGradedEvent } from '../../shared/events/homework.events';
import {
  sumQuestionPoints,
  normalizePoints,
  normalizeQtype,
  validateQuestionOptions,
  gradeQuestion,
  type QuestionType,
} from './homework.helpers';
import { getRubric, type Rubric } from './rubric.service';
import { assertGradableStudent } from './homework.service';

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
    correct: boolean | null; // null = essay chờ chấm, hoặc chưa qua close_date (C-1: ẩn)
  }[];
}

/* --------------------------------- Service --------------------------------- */

/**
 * Validate bộ câu hỏi quiz (dùng chung cho tạo mới và lưu đề): ném AppError
 * nếu câu hỏi/đáp án không hợp lệ. Không chạm DB — gọi trước mọi ghi dữ liệu.
 * Trả về bộ câu hỏi đã chuẩn hoá (qtype, options) để caller ghi DB trực tiếp.
 */
export function validateQuizQuestions(questions: QuizQuestionInput[]): NormalizedQuizQuestion[] {
  if (!Array.isArray(questions) || !questions.length) throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');
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

/**
 * Ghi bộ câu hỏi (đã validate) vào quiz trong transaction của caller — dùng chung cho
 * saveQuizQuestions, tạo bài nhiều lớp (HW-12) và reuseHomework.
 */
export async function insertQuizQuestionsTx(
  tx: Tx,
  homeworkId: number,
  questions: NormalizedQuizQuestion[]
): Promise<void> {
  const qStmt = await tx.prepare(
    'INSERT INTO quiz_questions (homework_id, position, qtype, question, points) VALUES (?, ?, ?, ?, ?)'
  );
  const oStmt = await tx.prepare(
    'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
  );
  for (const [qi, q] of questions.entries()) {
    const qr = await qStmt.run(homeworkId, qi, q.qtype, q.question, q.points);
    const qid = Number(qr.lastInsertRowid);
    // essay: không có đáp án trắc nghiệm
    for (const [oi, o] of q.options.entries()) await oStmt.run(qid, oi, o.text, o.is_correct ? 1 : 0);
  }
}

/** Lưu bộ câu hỏi cho quiz (thay thế toàn bộ). Validate TẤT CẢ trước khi xóa để tránh mất dữ liệu. */
export async function saveQuizQuestions(homeworkId: number, questions: QuizQuestionInput[]): Promise<void> {
  // Validate toàn bộ trước — không xóa gì nếu có lỗi (không cần lock)
  const normalized = validateQuizQuestions(questions);

  // Tất cả hợp lệ → thay thế trong transaction
  await db.transaction(async (tx) => {
    // P1-13: lock row homework để serialize với importFromBank/submitQuiz —
    // check attempts + xóa + ghi là 1 đơn vị nguyên tử, hết race TOCTOU
    const hw = (await tx.prepare('SELECT kind FROM homework WHERE id = ? FOR UPDATE').get(homeworkId)) as
      { kind: string } | undefined;
    if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
    // HW-17: chỉ quiz mới có đề — bài thường không được ghi câu hỏi/đè max_score
    if (hw.kind !== 'quiz') throw AppError.badRequest('Chỉ bài loại quiz mới lưu được câu hỏi');
    // Chặn sửa đề khi đã có học viên làm bài (tránh hỏng lịch sử)
    const attempts = (
      (await tx.prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ?').get(homeworkId)) as {
        c: number;
      }
    ).c;
    if (attempts > 0) {
      throw AppError.badRequest('Đã có học viên làm bài, không thể sửa đề. Hãy tạo quiz mới.');
    }
    const qids = (await tx
      .prepare('SELECT id FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId)) as { id: number }[];
    for (const q of qids) await tx.prepare('DELETE FROM quiz_options WHERE question_id = ?').run(q.id);
    await tx.prepare('DELETE FROM quiz_questions WHERE homework_id = ?').run(homeworkId);
    await insertQuizQuestionsTx(tx, homeworkId, normalized);
    // Đồng bộ max_score của bài theo đề mới (giữ điểm lẻ 0.5, không làm tròn)
    await tx
      .prepare('UPDATE homework SET max_score = ? WHERE id = ?')
      .run(sumQuestionPoints(normalized), homeworkId);
  });
}

/** Lấy câu hỏi cho học viên làm bài (ẩn đáp án đúng). */
export async function getQuizForStudent(homeworkId: number): Promise<QuizQuestion[]> {
  const qs = (await db
    .prepare(
      'SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id'
    )
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
    .prepare(
      'SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id'
    )
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

  let score = 0;
  let maxScore = 0;
  let attemptNo = 0;
  // HW-18: đọc đề + chấm + đếm lượt đều SAU khi lock row homework — saveQuizQuestions
  // (cũng lock row này) không thể xóa/ghi lại câu hỏi giữa lúc chấm và lúc ghi bài làm.
  const attemptId = await db.transaction(async (tx) => {
    // P1-13: lock row homework để serialize các lần nộp đồng thời cùng bài
    const locked = (await tx
      .prepare('SELECT max_attempts FROM homework WHERE id = ? FOR UPDATE')
      .get(homeworkId)) as { max_attempts: number | null };
    const questions = (await tx
      .prepare('SELECT id, qtype, points FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId)) as { id: number; qtype: string; points: number }[];
    if (questions.length === 0) throw AppError.badRequest('Quiz chưa có câu hỏi');

    // Chấm 40 câu = 1 query duy nhất thay vì 40 round-trip (hết N+1):
    // tải toàn bộ đáp án đúng của quiz trước, chấm trong memory.
    // Giữ đúng semantics cũ: đáp án phải đúng VÀ thuộc đúng câu hỏi
    // (đáp án của câu khác, dù đúng, vẫn bị chấm sai).
    const options = (await tx
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

    attemptNo =
      Number(
        (
          (await tx
            .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ? AND student_id = ?')
            .get(homeworkId, studentId)) as { c: number }
        ).c
      ) + 1;
    // C-1/J-A2: giới hạn lượt — đếm SAU lock row homework nên 2 lần nộp song song không vượt được.
    // (Tổng điểm từng lượt + điểm cao nhất vẫn hiện -> số lượt chính là giới hạn thông tin lộ đáp án.)
    if (locked?.max_attempts != null && attemptNo > locked.max_attempts) {
      throw AppError.conflict(`Đã hết ${locked.max_attempts} lượt làm bài`, 'MAX_ATTEMPTS');
    }

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

/** Đã qua hạn chót (close_date) → được lộ đáp án + đúng/sai từng câu cho học viên. */
function quizRevealed(closeDate: string | null): boolean {
  return !!closeDate && closeDate < todayVN();
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
        (await db.prepare('SELECT id, qtype FROM quiz_questions WHERE homework_id = ?').all(homeworkId)) as {
          id: number;
          qtype: string;
        }[]
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
    const grouped = new Map<
      string,
      { attempt_id: number; question_id: number; option_ids: number[]; answer_text: string | null }
    >();
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
    // C-1: chưa qua close_date thì không báo đúng/sai từng câu (chỉ tổng điểm) — xem getAttemptReview
    const hw = (await db.prepare('SELECT close_date FROM homework WHERE id = ?').get(homeworkId)) as
      { close_date: string | null } | undefined;
    const reveal = quizRevealed(hw?.close_date ?? null);
    for (const g of grouped.values()) {
      const qtype = qtypes.get(g.question_id) ?? 'single';
      const correct = reveal
        ? gradeQuestion(qtype, g.option_ids, correctIdsByQ.get(g.question_id) ?? [])
        : null;
      const list = answersByAttempt.get(g.attempt_id) ?? [];
      list.push({
        question_id: g.question_id,
        option_ids: g.option_ids,
        answer_text: g.answer_text,
        correct,
      });
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

/* ------------------------- Chấm tự luận theo rubric (YC2) ------------------------- */

export interface EssayQuestionInfo {
  question_id: number;
  question: string;
  points: number;
}

/** Thông tin quiz-level cho màn chấm: câu essay nào + rubric nào (để hiện/ẩn nút chấm). */
export async function getQuizEssayInfo(homeworkId: number): Promise<{
  essay_questions: EssayQuestionInfo[];
  rubric: Rubric | null;
}> {
  const hw = (await db.prepare('SELECT kind, rubric_id FROM homework WHERE id = ?').get(homeworkId)) as
    { kind: string; rubric_id: number | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const essay_questions =
    hw.kind === 'quiz'
      ? ((await db
          .prepare(
            `SELECT id as question_id, question, points FROM quiz_questions
             WHERE homework_id = ? AND qtype = 'essay' ORDER BY position, id`
          )
          .all(homeworkId)) as EssayQuestionInfo[])
      : [];
  const rubric = hw.rubric_id ? await getRubric(hw.rubric_id) : null;
  return { essay_questions, rubric };
}

/**
 * HW-5/HW-8: điểm tự luận theo từng câu, QUY ĐỔI về thang điểm của câu:
 * points × Σ(điểm tiêu chí) / tổng điểm rubric — chỉ tính tiêu chí của rubric HIỆN TẠI
 * (đổi rubric thì điểm tiêu chí của rubric cũ không còn cộng vào tổng).
 */
async function scaledEssayScores(
  conn: Pick<Tx, 'prepare'>,
  homeworkId: number,
  studentId: number,
  rubric: Rubric
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const ids = rubric.criteria.map((c) => c.id);
  if (!ids.length || !(rubric.total_score > 0)) return out;
  const rows = (await conn
    .prepare(
      `SELECT es.question_id, qq.points, SUM(es.score) as s
       FROM quiz_essay_scores es JOIN quiz_questions qq ON qq.id = es.question_id
       WHERE es.homework_id = ? AND es.student_id = ? AND es.criterion_id IN (${ids.map(() => '?').join(',')})
       GROUP BY es.question_id, qq.points`
    )
    .all(homeworkId, studentId, ...ids)) as { question_id: number; points: number; s: number }[];
  for (const r of rows) {
    // Làm tròn 2 chữ số: tránh 0.30000000000000004 khi cộng/so với max_score
    out.set(r.question_id, Math.round(((Number(r.points) * Number(r.s)) / rubric.total_score) * 100) / 100);
  }
  return out;
}

export interface EssayCriterionScore {
  criterion_id: number;
  score: number;
}

export interface EssayGradingQuestion extends EssayQuestionInfo {
  answer_text: string | null; // bài làm ở lượt mới nhất (null = bỏ trống)
  submitted_at: string | null;
  scores: EssayCriterionScore[]; // điểm đã chấm trước đó (nếu có)
}

export interface EssayGradingData {
  rubric: Rubric;
  questions: EssayGradingQuestion[];
  auto_score: number; // điểm trắc nghiệm cao nhất (quy tắc giữ điểm cao nhất)
  total_score: number | null; // tổng hiện tại (tự động + tay), null = chưa có
  feedback: string | null;
}

/** Dữ liệu form chấm tự luận của 1 học viên: bài làm + điểm đã chấm + tổng. */
export async function getEssayGrading(homeworkId: number, studentId: number): Promise<EssayGradingData> {
  const hw = (await db
    .prepare('SELECT class_id, kind, rubric_id FROM homework WHERE id = ?')
    .get(homeworkId)) as { class_id: number; kind: string; rubric_id: number | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  if (hw.kind !== 'quiz') throw AppError.badRequest('Chấm tự luận theo rubric chỉ áp dụng cho quiz');
  const rubric = hw.rubric_id ? await getRubric(hw.rubric_id) : null;
  if (!rubric) throw AppError.badRequest('Quiz chưa gắn rubric — hãy chọn rubric trước khi chấm tự luận');
  await assertGradableStudent(homeworkId, hw.class_id, studentId);

  const questions = (await db
    .prepare(
      `SELECT id as question_id, question, points FROM quiz_questions
       WHERE homework_id = ? AND qtype = 'essay' ORDER BY position, id`
    )
    .all(homeworkId)) as EssayQuestionInfo[];
  // Bài làm ở lượt mới nhất của học viên (giáo viên chấm bài mới nhất)
  const latest = (await db
    .prepare(
      `SELECT id, submitted_at FROM quiz_attempts
       WHERE homework_id = ? AND student_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 1`
    )
    .get(homeworkId, studentId)) as { id: number; submitted_at: string } | undefined;
  const answers = new Map<number, string | null>();
  if (latest && questions.length) {
    for (const r of (await db
      .prepare(
        `SELECT question_id, answer_text FROM quiz_answers
         WHERE attempt_id = ? AND question_id IN (${questions.map(() => '?').join(',')})`
      )
      .all(latest.id, ...questions.map((q) => q.question_id))) as {
      question_id: number;
      answer_text: string | null;
    }[]) {
      answers.set(r.question_id, r.answer_text);
    }
  }
  const scored = new Map<number, EssayCriterionScore[]>();
  const critIds = new Set(rubric.criteria.map((c) => c.id));
  for (const r of (await db
    .prepare(
      `SELECT question_id, criterion_id, score FROM quiz_essay_scores
       WHERE homework_id = ? AND student_id = ?`
    )
    .all(homeworkId, studentId)) as { question_id: number; criterion_id: number; score: number }[]) {
    if (!critIds.has(r.criterion_id)) continue; // HW-8: điểm của rubric cũ không hiện lại
    const list = scored.get(r.question_id) ?? [];
    list.push({ criterion_id: r.criterion_id, score: r.score });
    scored.set(r.question_id, list);
  }
  const auto_score = Number(
    (
      (await db
        .prepare(
          'SELECT COALESCE(MAX(score), 0) as m FROM quiz_attempts WHERE homework_id = ? AND student_id = ?'
        )
        .get(homeworkId, studentId)) as { m: number }
    ).m
  );
  const cur = (await db
    .prepare('SELECT score, feedback FROM homework_scores WHERE homework_id = ? AND student_id = ?')
    .get(homeworkId, studentId)) as { score: number | null; feedback: string | null } | undefined;
  return {
    rubric,
    questions: questions.map((q) => ({
      ...q,
      answer_text: answers.get(q.question_id) ?? null,
      submitted_at: latest?.submitted_at ?? null,
      scores: scored.get(q.question_id) ?? [],
    })),
    auto_score,
    total_score: cur?.score ?? null,
    feedback: cur?.feedback ?? null,
  };
}

export interface EssayGradeCriterionInput {
  criterion_id: number;
  score: number;
}

/**
 * Chấm 1 câu tự luận theo tiêu chí rubric.
 * - Idempotent: upsert từng dòng tiêu chí (chấm lại ghi đè).
 * - Trong cùng transaction: tổng = điểm tự động (lượt cao nhất) + tổng điểm tay
 *   mọi câu essay đã chấm → cập nhật homework_scores. Giữ số thập phân, không làm tròn.
 * - Phát sự kiện homework.graded như chấm tay bài thường.
 */
export async function gradeQuizEssay(
  homeworkId: number,
  studentId: number,
  questionId: number,
  criteria: EssayGradeCriterionInput[],
  feedback: string | null,
  gradedBy: number | null
): Promise<{ total: number; auto_score: number; essay_score: number }> {
  // --- Validate toàn bộ ở trust boundary, trước mọi ghi ---
  const hw = (await db
    .prepare('SELECT class_id, kind, rubric_id, max_score FROM homework WHERE id = ?')
    .get(homeworkId)) as
    { class_id: number; kind: string; rubric_id: number | null; max_score: number | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  if (hw.kind !== 'quiz') throw AppError.badRequest('Chấm tự luận theo rubric chỉ áp dụng cho quiz');
  if (!hw.rubric_id)
    throw AppError.badRequest('Quiz chưa gắn rubric — hãy chọn rubric trước khi chấm tự luận');
  const q = (await db
    .prepare('SELECT id, qtype FROM quiz_questions WHERE id = ? AND homework_id = ?')
    .get(questionId, homeworkId)) as { id: number; qtype: string } | undefined;
  if (!q) throw AppError.notFound('Không tìm thấy câu hỏi trong quiz này');
  if (normalizeQtype(q.qtype) !== 'essay')
    throw AppError.badRequest('Chỉ câu tự luận mới chấm tay theo rubric');
  await assertGradableStudent(homeworkId, hw.class_id, studentId);
  if (!Array.isArray(criteria) || criteria.length === 0)
    throw AppError.badRequest('Chưa nhập điểm cho tiêu chí nào');
  // Tiêu chí phải thuộc đúng rubric của quiz (chống ghi bừa criterion_id lạ)
  const rubric = await getRubric(hw.rubric_id);
  if (!rubric || !(rubric.total_score > 0)) throw AppError.badRequest('Rubric chưa có tiêu chí có điểm');
  const critById = new Map(rubric.criteria.map((c) => [c.id, c]));
  const seen = new Set<number>();
  const clean: { criterion_id: number; score: number }[] = [];
  for (const c of criteria) {
    if (typeof c !== 'object' || c === null || !Number.isInteger(c.criterion_id))
      throw AppError.badRequest('Tiêu chí chấm không hợp lệ');
    const def = critById.get(c.criterion_id);
    if (!def) throw AppError.badRequest('Tiêu chí không thuộc rubric của quiz này');
    if (seen.has(c.criterion_id)) throw AppError.badRequest('Tiêu chí bị nhập trùng');
    seen.add(c.criterion_id);
    const s = Number(c.score);
    if (!Number.isFinite(s) || s < 0) throw AppError.badRequest(`Điểm tiêu chí "${def.name}" không hợp lệ`);
    if (s > def.max_score)
      throw AppError.badRequest(`Điểm tiêu chí "${def.name}" không được vượt quá ${def.max_score}`);
    clean.push({ criterion_id: c.criterion_id, score: s });
  }
  const attemptCount = (
    (await db
      .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ? AND student_id = ?')
      .get(homeworkId, studentId)) as { c: number }
  ).c;
  if (attemptCount === 0) throw AppError.badRequest('Học viên chưa làm quiz này');

  let total = 0;
  let auto_score = 0;
  let essay_score = 0;
  await db.transaction(async (tx) => {
    // P1-13: lock row homework để serialize với submitQuiz (chấm tay và nộp bài
    // đồng thời không ghi đè lẫn nhau)
    await tx.prepare('SELECT id FROM homework WHERE id = ? FOR UPDATE').get(homeworkId);
    const up = await tx.prepare(
      `INSERT INTO quiz_essay_scores (homework_id, student_id, question_id, criterion_id, score, graded_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(homework_id, student_id, question_id, criterion_id)
       DO UPDATE SET score = excluded.score, graded_by = excluded.graded_by, graded_at = datetime('now')`
    );
    for (const c of clean) await up.run(homeworkId, studentId, questionId, c.criterion_id, c.score, gradedBy);
    auto_score = Number(
      (
        (await tx
          .prepare(
            'SELECT COALESCE(MAX(score), 0) as m FROM quiz_attempts WHERE homework_id = ? AND student_id = ?'
          )
          .get(homeworkId, studentId)) as { m: number }
      ).m
    );
    // HW-5/HW-8: mỗi câu quy đổi về điểm của câu, chỉ tiêu chí rubric hiện tại
    const perQ = await scaledEssayScores(tx, homeworkId, studentId, rubric);
    essay_score = Math.round([...perQ.values()].reduce((a, b) => a + b, 0) * 100) / 100;
    total = Math.round((auto_score + essay_score) * 100) / 100;
    // Chặn tổng vượt thang điểm (gõ nhầm) — nhất quán với gradeHomework
    if (hw.max_score != null && total > hw.max_score) {
      throw AppError.badRequest(`Tổng điểm không được vượt quá ${hw.max_score}`);
    }
    // feedback: chỉ ghi đè khi giáo viên nhập (null = giữ nhận xét cũ)
    await tx
      .prepare(
        `INSERT INTO homework_scores (homework_id, student_id, score, feedback, graded_by, graded_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(homework_id, student_id) DO UPDATE SET
           score = excluded.score, graded_by = excluded.graded_by, graded_at = datetime('now')
           ${feedback !== null ? ', feedback = excluded.feedback' : ''}`
      )
      .run(homeworkId, studentId, total, feedback, gradedBy);
    await tx
      .prepare(
        `INSERT INTO homework_completions (homework_id, student_id, completed_by)
         VALUES (?, ?, 'teacher') ON CONFLICT(homework_id, student_id) DO NOTHING`
      )
      .run(homeworkId, studentId);
  });
  eventBus.emitSync(new HomeworkGradedEvent(homeworkId, studentId, total, gradedBy));
  return { total, auto_score, essay_score };
}

/* ------------------------------- Xem lại bài làm ------------------------------- */

export interface QuizReview {
  question_id: number;
  question: string;
  qtype: string;
  points: number;
  /** is_correct null = ẩn đáp án (còn được làm lại, HW-4) */
  options: { id: number; text: string; is_correct: boolean | null; chosen: boolean }[];
  answer_text: string | null; // bài làm tự luận (câu essay)
  correct: boolean | null; // null = essay chờ chấm tay, hoặc chưa qua close_date (C-1: ẩn)
  essay_score: number | null; // điểm chấm tay câu essay (null = chưa chấm)
}

/** Chi tiết 1 lượt làm: câu hỏi + đáp án đúng/sai + đáp án đã chọn (Google Forms: review).
 * Câu essay hiện nội dung bài làm + trạng thái "chờ chấm" (correct = null). */
export async function getAttemptReview(attemptId: number, studentId: number): Promise<QuizReview[]> {
  const attempt = (await db
    .prepare(
      `SELECT qa.homework_id, qa.student_id, h.close_date, h.rubric_id
       FROM quiz_attempts qa JOIN homework h ON h.id = qa.homework_id WHERE qa.id = ?`
    )
    .get(attemptId)) as
    | { homework_id: number; student_id: number; close_date: string | null; rubric_id: number | null }
    | undefined;
  if (!attempt || attempt.student_id !== studentId) throw AppError.notFound('Không tìm thấy lượt làm bài');
  // HW-4 + C-1: còn được làm lại (chưa qua hạn chót close_date) thì KHÔNG lộ đáp án đúng từng
  // lựa chọn (is_correct = null) VÀ KHÔNG báo đúng/sai từng câu (correct = null) — nếu không,
  // xoay vòng đáp án qua các lượt làm sẽ dò ra điểm tối đa. Chỉ tổng điểm của lượt.
  // Không có close_date = làm lại mãi → không bao giờ lộ.
  const reveal = quizRevealed(attempt.close_date);
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
    .prepare(
      'SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position, id'
    )
    .all(attempt.homework_id)) as { id: number; qtype: string; question: string; points: number }[];
  // P1-4: 1 query duy nhất cho mọi đáp án thay vì 1 query/câu hỏi
  const options = await getOptionsBatch(qs.map((q) => q.id));
  // YC2: điểm chấm tay từng câu essay (theo học viên, không theo lượt làm) —
  // phụ huynh thấy điểm chi tiết phần tự luận đã chấm, hết badge "Chờ chấm".
  // HW-5: điểm đã quy đổi theo điểm câu (khớp tổng trong homework_scores)
  const rubric = attempt.rubric_id ? await getRubric(attempt.rubric_id) : null;
  const essayScores = rubric
    ? await scaledEssayScores(db, attempt.homework_id, attempt.student_id, rubric)
    : new Map<number, number>();
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
        is_correct: reveal ? o.is_correct === 1 : null,
        chosen: given.option_ids.includes(o.id),
      })),
      answer_text: given.answer_text,
      correct: reveal ? gradeQuestion(qtype, given.option_ids, correctIds) : null,
      essay_score: qtype === 'essay' ? (essayScores.get(q.id) ?? null) : null,
    };
  });
}
