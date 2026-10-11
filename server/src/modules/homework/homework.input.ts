/**
 * Chuẩn hóa + validate input tạo/sửa bài tập ở trust boundary (B3-3: tách khỏi homework.service.ts).
 */
import { AppError } from '../../shared/errors';
import { isValidUploadFilename } from '../../shared/upload';
import { assertValidDates, sumQuestionPoints } from './homework.helpers';
import { HOMEWORK_KIND, HOMEWORK_STATUS, type HomeworkKind, type HomeworkStatus } from './homework.types';

/** Chuyển thành ID hợp lệ, throw 400 nếu không phải số nguyên dương. */
function toValidId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('ID không hợp lệ');
  return n;
}

export interface PreparedHomeworkInput {
  class_ids: number[];
  title: string;
  content: string | null;
  due_date: string | null;
  status: HomeworkStatus;
  publish_at: string | null;
  max_score: number | null;
  close_date: string | null;
  kind: HomeworkKind;
  rubric_id: number | null;
  max_attempts: number | null;
  attachments: { name: string; url: string; kind: string }[];
  target_student_ids: number[];
  questions: unknown[];
}

/** C-1/J-A2: số lượt làm quiz tối đa — undefined = không gửi, null/'' = không giới hạn, 1..100. */
export function parseMaxAttempts(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw AppError.badRequest('Số lượt làm bài tối đa phải là số nguyên 1-100 (để trống = không giới hạn)');
  }
  return n;
}

/**
 * Chuẩn hóa + validate input tạo bài tập (tách khỏi route handler).
 * Ném AppError nếu input không hợp lệ.
 */
export function prepareCreateInput(raw: Record<string, unknown>): PreparedHomeworkInput {
  const classIds = (Array.isArray(raw.class_ids) ? raw.class_ids : [raw.class_ids])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!classIds.length) throw AppError.badRequest('Vui lòng chọn ít nhất 1 lớp học');

  const title = String(raw.title || '').trim();
  if (!title) throw AppError.badRequest('Vui lòng nhập tiêu đề bài tập');
  if (title.length > 200) throw AppError.badRequest('Tiêu đề tối đa 200 ký tự');

  const due_date = raw.due_date ? String(raw.due_date) : null;
  const close_date = raw.close_date ? String(raw.close_date) : null;
  assertValidDates(due_date, close_date);

  const status = (String(raw.status || 'published') as HomeworkStatus) || 'published';
  if (!(HOMEWORK_STATUS as readonly string[]).includes(status))
    throw AppError.badRequest('Trạng thái không hợp lệ');
  const publish_at = raw.publish_at ? String(raw.publish_at) : null;
  // P1-2: validate format hẹn đăng ngay khi tạo (như PUT) — sai format thì 400,
  // tránh bài scheduled kẹt vĩnh viễn vì publish_at không bao giờ khớp giờ
  if (publish_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publish_at)) {
    throw AppError.badRequest('Hẹn đăng không hợp lệ (YYYY-MM-DDTHH:mm)');
  }
  if (status === 'scheduled' && !publish_at) throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');

  // P1-12: kind không hợp lệ → 400 (như status), không ép ngầm thành 'homework'
  const kindRaw =
    raw.kind === undefined || raw.kind === null || raw.kind === '' ? 'homework' : String(raw.kind);
  if (!(HOMEWORK_KIND as readonly string[]).includes(kindRaw))
    throw AppError.badRequest('Loại bài tập không hợp lệ');
  const kind = kindRaw as HomeworkKind;
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (kind === 'quiz' && questions.length === 0) throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');

  // Quiz: max_score tự tính từ tổng điểm câu hỏi (1 thang điểm duy nhất)
  let max_score: number | null = null;
  if (kind === 'quiz') {
    max_score = sumQuestionPoints(questions as { points?: number }[]);
  } else if (raw.max_score !== null && raw.max_score !== undefined && raw.max_score !== '') {
    max_score = Number(raw.max_score);
    // HW-19: 0 điểm thì không chấm được (update/grade yêu cầu > 0) → chặn ngay khi tạo
    if (!Number.isFinite(max_score) || max_score <= 0)
      throw AppError.badRequest('Điểm tối đa phải lớn hơn 0');
  }

  const attachments =
    raw.attachments === undefined || raw.attachments === null
      ? []
      : validateAttachmentInputs(raw.attachments);
  const target_student_ids = Array.isArray(raw.target_student_ids)
    ? (raw.target_student_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  return {
    class_ids: classIds,
    title,
    content: raw.content ? String(raw.content).slice(0, 5000) : null,
    due_date,
    status,
    publish_at,
    max_score,
    close_date,
    kind,
    rubric_id: raw.rubric_id ? toValidId(raw.rubric_id) : null,
    max_attempts: kind === 'quiz' ? (parseMaxAttempts(raw.max_attempts) ?? null) : null,
    attachments,
    target_student_ids,
    questions,
  };
}

/** Đính kèm hợp lệ gửi kèm khi tạo/sửa bài tập. */
export interface HomeworkAttachmentInput {
  name: string;
  url: string;
  kind: string;
}

/**
 * Chuẩn hóa + validate danh sách đính kèm ở trust boundary (ném 400 nếu sai).
 * - url file phải là /uploads/<tên do server sinh> → kind ép thành 'file'
 * - url còn lại phải là link http/https → kind 'link'
 */
export function validateAttachmentInputs(raw: unknown): HomeworkAttachmentInput[] {
  if (!Array.isArray(raw)) throw AppError.badRequest('Đính kèm không hợp lệ');
  return raw.map((a) => {
    const name = String((a as { name?: unknown })?.name ?? '').trim();
    const url = String((a as { url?: unknown })?.url ?? '').trim();
    if (!name || !url) throw AppError.badRequest('Đính kèm thiếu tên hoặc đường dẫn');
    if (name.length > 200 || url.length > 2000) throw AppError.badRequest('Đính kèm quá dài');
    if (url.startsWith('/uploads/')) {
      if (!isValidUploadFilename(url.slice('/uploads/'.length))) {
        throw AppError.badRequest('Đường dẫn file đính kèm không hợp lệ');
      }
      return { name, url, kind: 'file' };
    }
    if (!/^https?:\/\//i.test(url))
      throw AppError.badRequest('Link đính kèm phải bắt đầu bằng http:// hoặc https://');
    return { name, url, kind: 'link' };
  });
}
