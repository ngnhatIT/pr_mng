// Hàm thuần + kiểu dùng chung cho form bài tập (HomeworkFormModal và các phần tách ra: QuizBuilder,
// AttachmentsField, RubricField, ClassTargeting).
import { UPLOAD_ACCEPT, MAX_UPLOAD_BYTES, type QuizQuestionForm } from './homework.api';
import { todayVN } from '../../shared/types';
import type { useFieldErrors } from '../../shared/components/Form';

/** Field có thể báo lỗi inline (thứ tự = thứ tự trên form, để focus field lỗi đầu tiên). */
export type HwErrKey =
  | 'classes'
  | 'title'
  | 'maxScore'
  | 'dueDate'
  | 'closeDate'
  | 'maxAttempts'
  | 'publishAt'
  | 'students'
  | 'quiz'
  | 'rubricName'
  | 'rubricCriteria'
  | 'attachment';

/** Kết quả useFieldErrors<HwErrKey>() của form cha, truyền xuống các phần con. */
export type HwFieldErrors = ReturnType<typeof useFieldErrors<HwErrKey>>;

/** URL http/https hợp lệ (dùng URL constructor thay vì regex tự chế). */
export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** C-1: số lượt làm mặc định cho quiz mới. */
export const DEFAULT_MAX_ATTEMPTS = '3';

/** Câu hỏi quiz chưa hợp lệ: thiếu nội dung / đáp án / đáp án đúng / điểm (server: điểm > 0 và ≤ 1000). Hàm thuần để test được. */
export function isQuizQuestionInvalid(q: QuizQuestionForm): boolean {
  const qtype = q.qtype ?? 'single';
  if (!q.question.trim()) return true;
  if (!(q.points > 0) || q.points > 1000) return true;
  if (qtype === 'essay') return false;
  const filled = q.options.filter((o) => o.text.trim());
  if (qtype === 'truefalse') return filled.length !== 2 || filled.filter((o) => o.is_correct).length !== 1;
  if (filled.length < 2) return true;
  const correctCount = filled.filter((o) => o.is_correct).length;
  return qtype === 'single' ? correctCount !== 1 : correctCount < 1;
}

/** Ngày nhanh cho hạn nộp, neo theo todayVN() (lịch VN) để không lệch ngày theo múi giờ máy. */
export function quickDate(kind: 'today' | 'tomorrow' | 'weekend' | 'nextweek'): string {
  const [y, m, day] = todayVN().split('-').map(Number);
  // Nửa đêm giờ máy: chỉ làm toán lịch (cộng ngày, thứ trong tuần), không đổi múi giờ khi xuất.
  const d = new Date(y, m - 1, day);
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
  if (kind === 'weekend') d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  if (kind === 'nextweek') d.setDate(d.getDate() + 7);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lỗi client check trước khi gửi file: 'type' | 'size' | null. Hàm thuần để test được. */
export function validateLocalUpload(name: string, size: number): 'type' | 'size' | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!UPLOAD_ACCEPT.split(',').includes(ext)) return 'type';
  if (size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

/** Chỉ giữ học viên còn thuộc các lớp đang chọn (đổi lớp không được để lại ID cũ). Hàm thuần để test được. */
export function pruneSelected(selected: number[], students: { id: number }[]): number[] {
  const ids = new Set(students.map((s) => s.id));
  const kept = selected.filter((id) => ids.has(id));
  return kept.length === selected.length ? selected : kept;
}

/**
 * Đính kèm gửi khi SỬA bài: chỉ gửi danh sách khi đã tải xong đính kèm hiện có;
 * còn đang tải / tải lỗi → undefined (server giữ nguyên), tránh gửi [] làm xóa hết file. Hàm thuần để test được.
 */
export function editAttachmentsPayload(
  load: 'loading' | 'ok' | 'error',
  list: { name: string; url: string; kind: string }[]
): { name: string; url: string; kind: string }[] | undefined {
  return load === 'ok' ? list.map((a) => ({ name: a.name, url: a.url, kind: a.kind })) : undefined;
}

export interface Attachment {
  id?: number; // có id = đính kèm đã lưu (chế độ sửa), không id = mới thêm trong phiên này
  name: string;
  url: string;
  kind: string;
}

/**
 * B4-1: link gõ dở (chưa bấm "+ Thêm") lúc lưu bài. Hàm thuần để test được.
 * null = không có gì; { error } = thiếu/sai URL (chặn lưu, báo inline);
 * { link } = tự thêm khi lưu (chưa nhập tên -> lấy URL làm tên).
 */
export function pendingLink(
  name: string,
  url: string
): { error: 'attRequired' | 'attUrlInvalid' } | { link: Attachment } | null {
  const n = name.trim();
  const u = url.trim();
  if (!n && !u) return null;
  if (!u) return { error: 'attRequired' };
  if (!isValidHttpUrl(u)) return { error: 'attUrlInvalid' };
  return { link: { name: n || u, url: u, kind: 'link' } };
}
