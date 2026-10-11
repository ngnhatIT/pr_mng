/**
 * Helpers dùng chung cho module Homework — common hoá triệt để.
 * Mọi logic dùng ở 2+ nơi đều tập trung ở đây.
 */
import { AppError } from '../../shared/errors';
import type { ScopeCtx } from '../../shared/scope';

/** Giờ hiện tại VN định dạng YYYY-MM-DDTHH:mm (khớp input datetime-local). */
export function nowVNMinute(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 16).replace(' ', 'T');
}

/**
 * Điều kiện SQL kiểm tra học viên được giao bài:
 * - Bài giao cả lớp (không có targets) → mọi học viên đều thấy
 * - Bài giao riêng → chỉ học viên trong homework_targets
 *
 * @param homeworkAlias alias của bảng homework trong query (mặc định 'h')
 * @param studentParam placeholder cho student_id (mặc định '?')
 */
export function targetScopeCond(homeworkAlias = 'h', studentParam = '?'): string {
  return (
    `(NOT EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ${homeworkAlias}.id) ` +
    `OR EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ${homeworkAlias}.id AND ht.student_id = ${studentParam}))`
  );
}

/**
 * Mẫu số tính tỷ lệ hoàn thành: số học viên được giao
 * (target riêng nếu có, ngược lại cả lớp).
 */
export function assignedCountExpr(homeworkAlias = 'h', classAlias = 'h'): string {
  return (
    `COALESCE(` +
    `NULLIF((SELECT COUNT(*) FROM homework_targets ht WHERE ht.homework_id = ${homeworkAlias}.id), 0),` +
    `(SELECT COUNT(*) FROM enrollments e WHERE e.class_id = ${classAlias}.class_id AND e.status = 'active')` +
    `)`
  );
}

/**
 * Chuẩn hoá điểm mỗi câu hỏi — P1-7: thiếu → 1 (quy ước cũ); có giá trị thì
 * phải là số > 0 và ≤ 1000, sai → 400 thay vì clamp im lặng như trước.
 */
export function normalizePoints(points: unknown, label = 'Điểm mỗi câu hỏi'): number {
  if (points === null || points === undefined || points === '') return 1;
  const n = Number(points);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) {
    throw AppError.badRequest(`${label} phải lớn hơn 0 và không quá 1000`);
  }
  return n;
}

/**
 * Tổng điểm tối đa từ danh sách câu hỏi — KHÔNG làm tròn (giữ điểm lẻ 0.5).
 * Dùng chung cho tạo quiz, lưu đề và import từ ngân hàng.
 */
export function sumQuestionPoints(questions: { points?: number | null }[]): number {
  return questions.reduce((s, q) => s + normalizePoints(q?.points), 0);
}

/**
 * Chặn đáp án trùng text (so sánh sau trim + lowercase) — dùng chung cho
 * quiz (quiz.service) và ngân hàng câu hỏi (questionBank.service). P1-8.
 */
export function assertUniqueOptionTexts(
  options: { text?: unknown }[] | undefined | null,
  message: string
): void {
  const texts = (options ?? []).map((o) =>
    String(o?.text ?? '')
      .trim()
      .toLowerCase()
  );
  if (new Set(texts).size !== texts.length) {
    throw AppError.badRequest(message);
  }
}

/* ------------------------------- Loại câu hỏi ------------------------------- */

/** Các loại câu hỏi quiz/ngân hàng: single (1 đáp án đúng), multiple (nhiều
 * đáp án đúng), truefalse (Đúng/Sai), essay (tự luận, chấm tay). */
export const QUESTION_TYPES = ['single', 'multiple', 'truefalse', 'essay'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Chuẩn hoá qtype: thiếu → 'single' (tương thích dữ liệu cũ); sai giá trị → 400. */
export function normalizeQtype(qtype: unknown, label = 'Loại câu hỏi'): QuestionType {
  if (qtype === null || qtype === undefined || qtype === '') return 'single';
  if (typeof qtype === 'string' && (QUESTION_TYPES as readonly string[]).includes(qtype)) {
    return qtype as QuestionType;
  }
  throw AppError.badRequest(`${label} không hợp lệ`);
}

/** Các mức độ câu hỏi trong ngân hàng. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Chuẩn hoá difficulty: thiếu → 'medium'; sai giá trị → 400. */
export function normalizeDifficulty(d: unknown, label = 'Mức độ'): Difficulty {
  if (d === null || d === undefined || d === '') return 'medium';
  if (typeof d === 'string' && (DIFFICULTIES as readonly string[]).includes(d)) {
    return d as Difficulty;
  }
  throw AppError.badRequest(`${label} không hợp lệ`);
}

/**
 * Validate đáp án theo loại câu hỏi (dùng chung quiz + ngân hàng):
 * - single: ≥2 đáp án, đúng 1 đáp án đúng, không trùng text
 * - multiple: ≥2 đáp án, ≥1 đáp án đúng, không trùng text
 * - truefalse: đúng 2 đáp án, đúng 1 đáp án đúng, không trùng text
 *   (client tự tạo sẵn 2 đáp án "Đúng"/"Sai", server chấp nhận nguyên văn)
 * - essay: bỏ qua options (tự luận chấm tay)
 * Trả về đáp án đã chuẩn hoá (essay → mảng rỗng).
 */
export function validateQuestionOptions(
  qtype: QuestionType,
  options: { text?: unknown; is_correct?: unknown }[] | undefined | null,
  label: string
): { text: string; is_correct: boolean }[] {
  if (qtype === 'essay') return [];
  const opts = Array.isArray(options) ? options : [];
  if (qtype === 'truefalse' && opts.length !== 2) {
    throw AppError.badRequest(`${label}: câu Đúng/Sai cần đúng 2 đáp án`);
  }
  if (opts.length < 2) throw AppError.badRequest(`${label}: cần ít nhất 2 đáp án`);
  const correctCount = opts.filter((o) => !!o?.is_correct).length;
  if (qtype === 'single' || qtype === 'truefalse') {
    if (correctCount !== 1) throw AppError.badRequest(`${label}: cần đúng 1 đáp án đúng`);
  } else if (correctCount < 1) {
    throw AppError.badRequest(`${label}: chưa chọn đáp án đúng`);
  }
  assertUniqueOptionTexts(opts, `${label}: có đáp án trùng nhau`);
  opts.forEach((o, i) => {
    if (typeof o?.text !== 'string' || !o.text.trim())
      throw AppError.badRequest(`${label}: đáp án ${i + 1} trống`);
  });
  return opts.map((o) => ({ text: String(o!.text).trim(), is_correct: !!o!.is_correct }));
}

/**
 * Chấm 1 câu hỏi theo loại — QUY TẮC CHẤM (đã chốt):
 * - single/truefalse: chọn đúng đáp án đúng → full điểm, ngược lại 0
 * - multiple: chọn đúng HẾT đáp án đúng và KHÔNG chọn đáp án sai → full điểm,
 *   ngược lại 0 (không cho điểm từng phần)
 * - essay: không chấm tự động (trả null → chờ chấm tay qua gradeHomework)
 */
export function gradeQuestion(
  qtype: QuestionType,
  chosenOptionIds: number[],
  correctOptionIds: number[]
): boolean | null {
  if (qtype === 'essay') return null;
  if (qtype === 'multiple') {
    // Khớp toàn bộ tập hợp: đúng số lượng và mọi đáp án chọn đều đúng
    if (chosenOptionIds.length !== correctOptionIds.length) return false;
    const correct = new Set(correctOptionIds);
    return chosenOptionIds.every((id) => correct.has(id));
  }
  return chosenOptionIds.length === 1 && correctOptionIds.includes(chosenOptionIds[0]);
}

/** Validate cặp hạn nộp / hạn chót cứng. */
export function assertValidDates(
  dueDate: string | null | undefined,
  closeDate: string | null | undefined
): void {
  if (dueDate && !isRealDate(dueDate)) {
    throw AppError.badRequest('Hạn nộp không hợp lệ (YYYY-MM-DD, ngày phải có thật)');
  }
  if (closeDate && !isRealDate(closeDate)) {
    throw AppError.badRequest('Hạn chót không hợp lệ (YYYY-MM-DD, ngày phải có thật)');
  }
  if (dueDate && closeDate && closeDate < dueDate) {
    throw AppError.badRequest('Hạn chót cứng phải sau hạn nộp');
  }
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Điều kiện scope (trung tâm + scope own) cho query bài tập alias h JOIN classes c. */
export function scopeConds(ctx: ScopeCtx, params: unknown[]): string[] {
  const conds = ['1=1'];
  if (ctx.centerId !== null) {
    conds.push('(h.center_id = ? OR (h.center_id IS NULL AND c.center_id = ?))');
    params.push(ctx.centerId, ctx.centerId);
  }
  if (ctx.ownOnly) {
    // Scope 'own' (giáo viên hoặc custom role scope own): chỉ lớp của mình dạy.
    // teacherId null → c.teacher_id = NULL không khớp dòng nào (fail-closed).
    conds.push('c.teacher_id = ?');
    params.push(ctx.teacherId);
  }
  return conds;
}
