/**
 * Helpers dùng chung cho module Homework — common hoá triệt để.
 * Mọi logic dùng ở 2+ nơi đều tập trung ở đây.
 */
import { AppError } from '../../shared/errors';

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
  const texts = (options ?? []).map((o) => String(o?.text ?? '').trim().toLowerCase());
  if (new Set(texts).size !== texts.length) {
    throw AppError.badRequest(message);
  }
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
