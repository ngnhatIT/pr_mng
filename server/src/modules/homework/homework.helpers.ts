/**
 * Helpers dùng chung cho module Homework — common hoá triệt để.
 * Mọi logic dùng ở 2+ nơi đều tập trung ở đây.
 */
import { AppError } from '../../shared/errors';

/** Ngày hiện tại theo múi giờ Việt Nam, định dạng YYYY-MM-DD. */
export function todayVN(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

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

/** Validate cặp hạn nộp / hạn chót cứng. */
export function assertValidDates(
  dueDate: string | null | undefined,
  closeDate: string | null | undefined
): void {
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw AppError.badRequest('Hạn nộp không hợp lệ (YYYY-MM-DD)');
  }
  if (closeDate && !/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) {
    throw AppError.badRequest('Hạn chót không hợp lệ (YYYY-MM-DD)');
  }
  if (dueDate && closeDate && closeDate < dueDate) {
    throw AppError.badRequest('Hạn chót cứng phải sau hạn nộp');
  }
}
