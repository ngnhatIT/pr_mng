import { db } from '../../db';
import { AppError } from '../../shared/errors';

/* ---------------------------------- Types ---------------------------------- */

export interface BankQuestion {
  id: number;
  tag: string | null;
  question: string;
  points: number;
  options: { id: number; text: string; is_correct: boolean }[];
}

export interface BankQuestionInput {
  tag?: string | null;
  question: string;
  points: number;
  options: { text: string; is_correct: boolean }[];
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách câu hỏi trong ngân hàng (tìm kiếm + lọc tag). */
export async function listBankQuestions(
  centerId: number | null,
  search = '',
  tag = ''
): Promise<BankQuestion[]> {
  const conds = ['1=1'];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('(center_id = ? OR center_id IS NULL)');
    params.push(centerId);
  }
  if (search.trim()) {
    conds.push('question LIKE ?');
    params.push(`%${search.trim()}%`);
  }
  if (tag) {
    conds.push('tag = ?');
    params.push(tag);
  }
  const rows = await db.prepare(`SELECT * FROM question_bank WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT 100`)
    .all(...params) as { id: number; tag: string | null; question: string; points: number }[];
  return Promise.all(rows.map(async (r) => ({
    ...r,
    options: await db.prepare('SELECT id, text, is_correct FROM question_bank_options WHERE question_id = ? ORDER BY position')
      .all(r.id) as { id: number; text: string; is_correct: boolean }[],
  })));
}

/** Các tag đã dùng (để filter). */
export async function listBankTags(centerId: number | null): Promise<string[]> {
  const params: unknown[] = [];
  let cond = '1=1';
  if (centerId !== null) {
    cond = '(center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const rows = await db.prepare(`SELECT DISTINCT tag FROM question_bank WHERE ${cond} AND tag IS NOT NULL AND tag != '' ORDER BY tag`)
    .all(...params) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/** Thêm câu hỏi vào ngân hàng. Validate hết trước khi insert (tránh câu mồ côi). */
export async function addBankQuestion(
  centerId: number | null,
  createdBy: number,
  input: BankQuestionInput
): Promise<BankQuestion> {
  if (!input.question.trim()) throw AppError.badRequest('Câu hỏi trống');
  if (input.options.length < 2) throw AppError.badRequest('Cần ít nhất 2 đáp án');
  if (!input.options.some((o) => o.is_correct)) throw AppError.badRequest('Chưa chọn đáp án đúng');
  input.options.forEach((o, i) => {
    if (!o.text.trim()) throw AppError.badRequest(`Đáp án ${i + 1} trống`);
  });
  const qid = await db.transaction(async (tx) => {
    const ins = await tx.prepare('INSERT INTO question_bank (center_id, tag, question, points, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(centerId, input.tag?.trim() || null, input.question.trim(), Math.max(0.5, Number(input.points) || 1), createdBy);
    const qid = Number(ins.lastInsertRowid);
    const stmt = await tx.prepare(
      'INSERT INTO question_bank_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
    );
    for (const [i, o] of input.options.entries()) {
      await stmt.run(qid, i, o.text.trim(), o.is_correct ? 1 : 0);
    }
    return qid;
  });
  return (await listBankQuestions(centerId)).find((q) => q.id === qid)!;
}

/** Xóa câu hỏi khỏi ngân hàng (kiểm tra center để chống cross-tenant). */
export async function deleteBankQuestion(id: number, centerId: number | null): Promise<void> {
  const q = await db.prepare('SELECT center_id FROM question_bank WHERE id = ?').get(id) as
    | { center_id: number | null }
    | undefined;
  if (!q) return;
  if (centerId !== null && q.center_id !== null && q.center_id !== centerId) {
    throw AppError.notFound('Không tìm thấy câu hỏi');
  }
  await db.prepare('DELETE FROM question_bank_options WHERE question_id = ?').run(id);
  await db.prepare('DELETE FROM question_bank WHERE id = ?').run(id);
}

/** Import câu hỏi từ ngân hàng vào quiz (copy) — chỉ lấy câu thuộc center. */
export async function importFromBank(homeworkId: number, bankIds: number[], centerId: number | null): Promise<number> {
  const qStmt = await db.prepare(
    'INSERT INTO quiz_questions (homework_id, position, question, points) VALUES (?, ?, ?, ?)'
  );
  const oStmt = await db.prepare(
    'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
  );
  const maxPos = (await db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM quiz_questions WHERE homework_id = ?')
    .get(homeworkId) as { m: number }).m;
  let count = 0;
  // Lọc bankIds theo center trước khi import (chống rò rỉ cross-tenant)
  const placeholders = bankIds.map(() => '?').join(',');
  const params: unknown[] = [...bankIds];
  let scopeCond = '';
  if (centerId !== null) {
    scopeCond = 'AND (center_id = ? OR center_id IS NULL)';
    params.push(centerId);
  }
  const valid = await db.prepare(`SELECT id, question, points FROM question_bank WHERE id IN (${placeholders}) ${scopeCond}`)
    .all(...params) as { id: number; question: string; points: number }[];
  for (const [bi, bq] of valid.entries()) {
    const qr = await qStmt.run(homeworkId, maxPos + 1 + bi, bq.question, bq.points);
    const nqid = Number(qr.lastInsertRowid);
    const opts = await db.prepare('SELECT text, is_correct FROM question_bank_options WHERE question_id = ? ORDER BY position')
      .all(bq.id) as { text: string; is_correct: number }[];
    for (const [oi, o] of opts.entries()) await oStmt.run(nqid, oi, o.text, o.is_correct);
    count++;
  }
  return count;
}
