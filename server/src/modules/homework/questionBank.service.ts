import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { escapeLike } from '../../shared/like';
import {
  sumQuestionPoints,
  normalizePoints,
  normalizeQtype,
  normalizeDifficulty,
  validateQuestionOptions,
  type QuestionType,
  type Difficulty,
} from './homework.helpers';

/* ---------------------------------- Types ---------------------------------- */

export interface BankQuestion {
  id: number;
  tag: string | null;
  subject: string | null;
  difficulty: Difficulty;
  qtype: QuestionType;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean }[];
}

export interface BankQuestionInput {
  tag?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  qtype?: string | null;
  question: string;
  points: number;
  options: { text: string; is_correct: boolean }[];
}

interface BankRow {
  id: number;
  tag: string | null;
  subject: string | null;
  difficulty: Difficulty;
  qtype: QuestionType;
  question: string;
  points: number;
}

/* --------------------------------- Service --------------------------------- */

import { parsePagination, paginate, type Paginated } from '../../shared/pagination';

/** Danh sách câu hỏi trong ngân hàng (tìm kiếm + lọc tag/môn/mức độ + phân trang). */
export async function listBankQuestions(
  centerId: number | null,
  search = '',
  tag = '',
  pageOpts: { page?: number; limit?: number } = {},
  filters: { subject?: string; difficulty?: string } = {}
): Promise<Paginated<BankQuestion>> {
  const { page, limit, offset } = parsePagination(pageOpts);
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('(center_id = ? OR center_id IS NULL)');
    params.push(centerId);
  }
  if (search.trim()) {
    conds.push("question LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(search.trim())}%`);
  }
  if (tag) {
    conds.push('tag = ?');
    params.push(tag);
  }
  if (filters.subject?.trim()) {
    conds.push("subject ILIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.subject.trim())}%`);
  }
  if (filters.difficulty) {
    conds.push('difficulty = ?');
    params.push(normalizeDifficulty(filters.difficulty));
  }
  const where = conds.join(' AND ');
  const totalRow = (await db
    .prepare(`SELECT COUNT(*) as c FROM question_bank WHERE ${where}`)
    .get(...params)) as { c: string };
  const total = Number(totalRow?.c) || 0;
  const rows = (await db
    .prepare(`SELECT * FROM question_bank WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as BankRow[];
  // HW-15: 1 query cho đáp án của cả trang (hết N+1), gom theo question_id trong memory
  const byQ = new Map<number, { id: number; text: string; is_correct: boolean }[]>();
  if (rows.length) {
    const opts = (await db
      .prepare(
        `SELECT id, question_id, text, is_correct FROM question_bank_options
         WHERE question_id IN (${rows.map(() => '?').join(',')}) ORDER BY question_id, position`
      )
      .all(...rows.map((r) => r.id))) as {
      id: number;
      question_id: number;
      text: string;
      is_correct: number;
    }[];
    for (const o of opts) {
      const list = byQ.get(o.question_id) ?? [];
      list.push({ id: o.id, text: o.text, is_correct: !!o.is_correct });
      byQ.set(o.question_id, list);
    }
  }
  const questions = rows.map((r) => ({ ...r, options: byQ.get(r.id) ?? [] }));
  return paginate(questions, total, page, limit);
}

/**
 * Lấy 1 câu hỏi bank kèm đáp án, đọc trực tiếp theo id (không qua trang 1 của
 * listBankQuestions) — P1-4: bank > 20 câu thì find() trong page 1 trả undefined.
 */
async function getBankQuestion(id: number, centerId: number | null): Promise<BankQuestion | null> {
  const params: unknown[] = [id];
  let cond = 'id = ?';
  if (centerId !== null) {
    cond += ' AND (center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const r = (await db.prepare(`SELECT * FROM question_bank WHERE ${cond}`).get(...params)) as
    BankRow | undefined;
  if (!r) return null;
  const options = (await db
    .prepare('SELECT id, text, is_correct FROM question_bank_options WHERE question_id = ? ORDER BY position')
    .all(r.id)) as { id: number; text: string; is_correct: number }[];
  // Cột is_correct là INTEGER 0/1 — trả boolean đúng kiểu BankQuestion
  return { ...r, options: options.map((o) => ({ ...o, is_correct: !!o.is_correct })) };
}

/** Các tag đã dùng (để filter). */
export async function listBankTags(centerId: number | null): Promise<string[]> {
  const params: unknown[] = [];
  let cond = '1=1';
  if (centerId !== null) {
    cond = '(center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const rows = (await db
    .prepare(
      `SELECT DISTINCT tag FROM question_bank WHERE ${cond} AND tag IS NOT NULL AND tag != '' ORDER BY tag`
    )
    .all(...params)) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/** Các môn đã dùng (để filter). */
export async function listBankSubjects(centerId: number | null): Promise<string[]> {
  const params: unknown[] = [];
  let cond = '1=1';
  if (centerId !== null) {
    cond = '(center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const rows = (await db
    .prepare(
      `SELECT DISTINCT subject FROM question_bank WHERE ${cond} AND subject IS NOT NULL AND subject != '' ORDER BY subject`
    )
    .all(...params)) as { subject: string }[];
  return rows.map((r) => r.subject);
}

/**
 * Validate input câu hỏi bank dùng chung cho thêm/sửa: thiếu field bắt buộc →
 * 400 (không để trim() trên undefined gây 500). Validate theo loại câu hỏi.
 */
function validateBankInput(input: BankQuestionInput): {
  question: string;
  qtype: QuestionType;
  subject: string | null;
  difficulty: Difficulty;
  options: { text: string; is_correct: boolean }[];
  points: number;
} {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) throw AppError.badRequest('Câu hỏi trống');
  const qtype = normalizeQtype(input.qtype, 'Loại câu hỏi');
  const options = validateQuestionOptions(qtype, input.options, 'Câu hỏi');
  // P1-7: điểm âm/khổng lồ/không phải số → 400, không clamp im lặng
  const points = normalizePoints(input.points, 'Điểm câu hỏi');
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (subject.length > 100) throw AppError.badRequest('Môn học quá dài (tối đa 100 ký tự)');
  const difficulty = normalizeDifficulty(input.difficulty, 'Mức độ');
  return { question, qtype, subject: subject || null, difficulty, options, points };
}

/** Thêm câu hỏi vào ngân hàng. Validate hết trước khi insert (tránh câu mồ côi). */
export async function addBankQuestion(
  centerId: number | null,
  createdBy: number,
  input: BankQuestionInput
): Promise<BankQuestion> {
  const { question, qtype, subject, difficulty, options, points } = validateBankInput(input);
  const qid = await db.transaction(async (tx) => {
    const ins = await tx
      .prepare(
        'INSERT INTO question_bank (center_id, tag, subject, difficulty, qtype, question, points, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(centerId, input.tag?.trim() || null, subject, difficulty, qtype, question, points, createdBy);
    const qid = Number(ins.lastInsertRowid);
    const stmt = await tx.prepare(
      'INSERT INTO question_bank_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    for (const [i, o] of options.entries()) {
      await stmt.run(qid, i, o.text, o.is_correct ? 1 : 0);
    }
    return qid;
  });
  // P1-4: trả row vừa insert trực tiếp, không find lại trong page 1
  return (await getBankQuestion(qid, centerId))!;
}

/** Sửa câu hỏi trong ngân hàng: validate trước, update + thay toàn bộ đáp án trong 1 transaction. */
export async function updateBankQuestion(
  id: number,
  centerId: number | null,
  input: BankQuestionInput
): Promise<BankQuestion> {
  const q = (await db.prepare('SELECT center_id FROM question_bank WHERE id = ?').get(id)) as
    { center_id: number | null } | undefined;
  if (!q) throw AppError.notFound('Không tìm thấy câu hỏi');
  // P1-10: câu hỏi global (center_id NULL, do superadmin tạo) chỉ superadmin
  // (centerId null) được sửa — center thường chỉ được đọc/dùng chung, không sửa.
  if (q.center_id === null && centerId !== null) throw AppError.notFound('Không tìm thấy câu hỏi');
  if (centerId !== null && q.center_id !== null && q.center_id !== centerId) {
    throw AppError.notFound('Không tìm thấy câu hỏi');
  }
  const { question, qtype, subject, difficulty, options, points } = validateBankInput(input);
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        'UPDATE question_bank SET tag = ?, subject = ?, difficulty = ?, qtype = ?, question = ?, points = ? WHERE id = ?'
      )
      .run(input.tag?.trim() || null, subject, difficulty, qtype, question, points, id);
    await tx.prepare('DELETE FROM question_bank_options WHERE question_id = ?').run(id);
    const stmt = await tx.prepare(
      'INSERT INTO question_bank_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    for (const [i, o] of options.entries()) {
      await stmt.run(id, i, o.text.trim(), o.is_correct ? 1 : 0);
    }
  });
  // P1-4: trả row vừa update trực tiếp, không find lại trong page 1
  return (await getBankQuestion(id, centerId))!;
}

/** Xóa câu hỏi khỏi ngân hàng (kiểm tra center để chống cross-tenant). */
export async function deleteBankQuestion(id: number, centerId: number | null): Promise<void> {
  const q = (await db.prepare('SELECT center_id FROM question_bank WHERE id = ?').get(id)) as
    { center_id: number | null } | undefined;
  if (!q) return;
  // P1-10: câu hỏi global chỉ superadmin (centerId null) được xóa
  if (q.center_id === null && centerId !== null) throw AppError.notFound('Không tìm thấy câu hỏi');
  if (centerId !== null && q.center_id !== null && q.center_id !== centerId) {
    throw AppError.notFound('Không tìm thấy câu hỏi');
  }
  await db.prepare('DELETE FROM question_bank_options WHERE question_id = ?').run(id);
  await db.prepare('DELETE FROM question_bank WHERE id = ?').run(id);
}

/** Import câu hỏi từ ngân hàng vào quiz (copy) — chỉ lấy câu thuộc center. */
export async function importFromBank(
  homeworkId: number,
  bankIds: number[],
  centerId: number | null
): Promise<number> {
  // P1-9: dedupe id + loại giá trị rác; giữ đúng thứ tự client gửi khi gán position
  // (WHERE id IN (...) không đảm bảo thứ tự trả về)
  const uniqueIds = [...new Set(bankIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniqueIds.length) throw AppError.badRequest('Chưa chọn câu hỏi để import');
  // Chỉ import vào bài loại quiz — import vào bài thường sẽ ghi đè max_score sai nghĩa
  const hw = (await db.prepare('SELECT kind FROM homework WHERE id = ?').get(homeworkId)) as
    { kind: string } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  if (hw.kind !== 'quiz') throw AppError.badRequest('Chỉ được import câu hỏi vào bài quiz');
  // Lọc bankIds theo center trước khi import (chống rò rỉ cross-tenant)
  const placeholders = uniqueIds.map(() => '?').join(',');
  const params: unknown[] = [...uniqueIds];
  let scopeCond = '';
  if (centerId !== null) {
    scopeCond = 'AND (center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const valid = (await db
    .prepare(
      `SELECT id, qtype, question, points FROM question_bank WHERE id IN (${placeholders}) ${scopeCond}`
    )
    .all(...params)) as { id: number; qtype: string; question: string; points: number }[];
  if (!valid.length) throw AppError.badRequest('Không tìm thấy câu hỏi hợp lệ để import');
  // Sắp lại theo đúng thứ tự client gửi (bỏ id không tồn tại/khác center)
  const byId = new Map(valid.map((q) => [q.id, q]));
  const ordered = uniqueIds
    .map((bid) => byId.get(bid))
    .filter((q): q is { id: number; qtype: string; question: string; points: number } => !!q);
  const optsAll = (await db
    .prepare(
      `SELECT question_id, text, is_correct FROM question_bank_options
       WHERE question_id IN (${ordered.map(() => '?').join(',')}) ORDER BY question_id, position`
    )
    .all(...ordered.map((v) => v.id))) as { question_id: number; text: string; is_correct: number }[];
  // Toàn bộ import trong 1 transaction (tránh import dở khi lỗi giữa chừng)
  const count = await db.transaction(async (tx) => {
    // P1-13: lock row homework — check attempts + import là 1 đơn vị nguyên tử,
    // hết race TOCTOU với saveQuizQuestions/submitQuiz
    await tx.prepare('SELECT id FROM homework WHERE id = ? FOR UPDATE').get(homeworkId);
    // Chặn import khi đã có học viên làm bài (đồng nhất với saveQuizQuestions)
    const attempts = (
      (await tx.prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE homework_id = ?').get(homeworkId)) as {
        c: number;
      }
    ).c;
    if (attempts > 0) {
      throw AppError.badRequest('Đã có học viên làm bài, không thể thêm câu hỏi. Hãy tạo quiz mới.');
    }
    const maxPos = (
      (await tx
        .prepare('SELECT COALESCE(MAX(position), -1) as m FROM quiz_questions WHERE homework_id = ?')
        .get(homeworkId)) as { m: number }
    ).m;
    const qStmt = await tx.prepare(
      'INSERT INTO quiz_questions (homework_id, position, qtype, question, points) VALUES (?, ?, ?, ?, ?)'
    );
    const oStmt = await tx.prepare(
      'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    let n = 0;
    for (const [bi, bq] of ordered.entries()) {
      const qr = await qStmt.run(
        homeworkId,
        maxPos + 1 + bi,
        normalizeQtype(bq.qtype),
        bq.question,
        bq.points
      );
      const nqid = Number(qr.lastInsertRowid);
      const opts = optsAll.filter((o) => o.question_id === bq.id);
      for (const [oi, o] of opts.entries()) await oStmt.run(nqid, oi, o.text, o.is_correct);
      n++;
    }
    // Đồng bộ max_score của bài = tổng điểm TẤT CẢ câu hỏi (cũ + mới import),
    // giữ điểm lẻ 0.5, không làm tròn
    const allPoints = (await tx
      .prepare('SELECT points FROM quiz_questions WHERE homework_id = ?')
      .all(homeworkId)) as { points: number }[];
    await tx
      .prepare('UPDATE homework SET max_score = ? WHERE id = ?')
      .run(sumQuestionPoints(allPoints), homeworkId);
    return n;
  });
  return count;
}
