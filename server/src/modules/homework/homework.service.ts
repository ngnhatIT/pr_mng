import { db } from '../../db';
import type { Tx } from '../../db';
import type { ScopeCtx } from '../../shared/scope';
import { countQuizQuestions } from './quiz.service';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { DAY_MS } from '../../shared/time';
import { AppError } from '../../shared/errors';
import { nowVNMinute, assignedCountExpr, assertValidDates, sumQuestionPoints } from './homework.helpers';
import { todayVN } from '../../shared/vnTime';
import { homeworkRepo, deleteHomeworkCascade } from './homework.repo';
import { eventBus } from '../../shared/events/eventBus';
import { escapeLike } from '../../shared/like';
import { copyUploadedFileByUrl } from '../../shared/upload';
import { getRubric } from './rubric.service';

/** Chuyển thành ID hợp lệ, throw 400 nếu không phải số nguyên dương. */
function toValidId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('ID không hợp lệ');
  return n;
}
import {
  HomeworkCreatedEvent,
  HomeworkPublishedEvent,
  HomeworkUnpublishedEvent,
  HomeworkDeletedEvent,
  HomeworkGradedEvent,
} from '../../shared/events/homework.events';

/* ---------------------------------- Types ---------------------------------- */

/** Trạng thái bài tập — dùng const thay vì string literal rải rác (chống typo). */
export const HOMEWORK_STATUS = ['draft', 'scheduled', 'published'] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUS)[number];

/** Loại bài tập. */
export const HOMEWORK_KIND = ['homework', 'quiz'] as const;
export type HomeworkKind = (typeof HOMEWORK_KIND)[number];

/** Ai đánh dấu hoàn thành. */
export type CompletedBy = 'parent' | 'teacher' | 'student';

/** Context phân quyền tối thiểu mà service cần (tách khỏi AuthRequest). */
export interface HomeworkRow {
  id: number;
  class_id: number;
  class_name?: string;
  center_id: number | null;
  title: string;
  content: string | null;
  due_date: string | null;
  created_at: string;
  status: HomeworkStatus;
  publish_at: string | null;
  max_score: number | null;
  close_date: string | null;
  kind: HomeworkKind;
  rubric_id: number | null;
  completed_count?: number;
  student_count?: number;
  question_count?: number;
  attachments?: { id: number; name: string; url: string; kind: string }[];
  [key: string]: unknown;
}

export interface HomeworkQuery {
  class_id?: string;
  search?: string;
  due?: '' | 'upcoming' | 'overdue' | 'nodate';
  status?: '' | 'draft' | 'scheduled' | 'published';
  kind?: '' | 'homework' | 'quiz';
}

export interface CreateHomeworkInput {
  class_ids: number[];
  title: string;
  content?: string | null;
  due_date?: string | null;
  created_by: number;
  centerId: number | null;
  status?: string;
  publish_at?: string | null;
  max_score?: number | null;
  close_date?: string | null;
  kind?: string;
  rubric_id?: number | null;
  attachments?: { name: string; url: string; kind: string }[];
  target_student_ids?: number[];
}

/* --------------------------------- Helpers --------------------------------- */

function scopeConds(ctx: ScopeCtx, params: unknown[]): string[] {
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

function dueCond(due: string, conds: string[], params: unknown[]): void {
  const today = todayVN();
  if (due === 'overdue') {
    conds.push('h.due_date IS NOT NULL AND h.due_date < ?');
    params.push(today);
  } else if (due === 'upcoming') {
    conds.push('h.due_date IS NOT NULL AND h.due_date >= ?');
    params.push(today);
  } else if (due === 'nodate') {
    conds.push('h.due_date IS NULL');
  }
}

/* --------------------------------- Service --------------------------------- */

/**
 * Danh sách bài tập (có phân trang, tìm kiếm, lọc hạn).
 */
export async function listHomework(
  ctx: ScopeCtx,
  query: HomeworkQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<HomeworkRow>> {
  const params: unknown[] = [];
  const conds = scopeConds(ctx, params);
  const { class_id = '', search = '', due = '', status = '', kind = '' } = query;
  if (class_id) {
    conds.push('h.class_id = ?');
    params.push(Number(class_id));
  }
  if (search.trim()) {
    const term = escapeLike(search.trim());
    conds.push("(h.title LIKE ? ESCAPE '\\' OR h.content LIKE ? ESCAPE '\\')");
    params.push(`%${term}%`, `%${term}%`);
  }
  if (due) dueCond(due, conds, params);
  if (status) {
    conds.push('h.status = ?');
    params.push(status);
  }
  if (kind) {
    conds.push('h.kind = ?');
    params.push(kind);
  }

  const from = `FROM homework h JOIN classes c ON c.id = h.class_id`;
  const where = `WHERE ${conds.join(' AND ')}`;
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  // P1-4: gộp 4 correlated subquery/row thành JOIN + GROUP BY (1 round-trip).
  // COUNT(DISTINCT ...) chống nhân dòng do fan-out của các JOIN.
  // student_count giữ đúng ngữ nghĩa assignedCountExpr: có target riêng → đếm
  // target, không có → đếm học viên đang học của lớp.
  const rows = (await db
    .prepare(
      `SELECT h.*, c.name as class_name,
        COUNT(DISTINCT hc.id) as completed_count,
        COALESCE(
          NULLIF(COUNT(DISTINCT ht.student_id), 0),
          COUNT(DISTINCT e.student_id)
        ) as student_count,
        COUNT(DISTINCT qq.id) as question_count
       ${from}
       LEFT JOIN homework_completions hc ON hc.homework_id = h.id
       LEFT JOIN homework_targets ht ON ht.homework_id = h.id
       LEFT JOIN enrollments e ON e.class_id = h.class_id AND e.status = 'active'
       LEFT JOIN quiz_questions qq ON qq.homework_id = h.id
       ${where} GROUP BY h.id, c.name ORDER BY h.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as HomeworkRow[];
  return paginate(rows, total, page, limit);
}

/** Thống kê nhanh cho header: tổng, sắp hết hạn (≤3 ngày), quá hạn. Chỉ tính bài đã đăng. */
export async function getHomeworkStats(
  ctx: ScopeCtx
): Promise<{ total: number; dueSoon: number; overdue: number; drafts: number }> {
  const params: unknown[] = [];
  const conds = scopeConds(ctx, params);
  const from = `FROM homework h JOIN classes c ON c.id = h.class_id`;
  const where = `WHERE ${conds.join(' AND ')}`;
  const today = todayVN();
  const soon = new Date(Date.now() + 3 * DAY_MS).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const q = async (extra: string, ...p: unknown[]) =>
    (
      (await db.prepare(`SELECT COUNT(*) as c ${from} ${where} ${extra}`).get(...params, ...p)) as {
        c: number;
      }
    ).c;
  const pub = `AND h.status = 'published'`;
  return {
    total: await q(pub),
    dueSoon: await q(
      `${pub} AND h.due_date IS NOT NULL AND h.due_date >= ? AND h.due_date <= ?`,
      today,
      soon
    ),
    overdue: await q(`${pub} AND h.due_date IS NOT NULL AND h.due_date < ?`, today),
    drafts: await q(`AND h.status IN ('draft', 'scheduled')`),
  };
}

/**
 * Tạo bài tập cho NHIỀU lớp cùng lúc (1 lần giao cho nhiều lớp).
 * Hỗ trợ: draft/scheduled, điểm số, hạn chót, quiz, rubric, đính kèm, giao riêng.
 */
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
  attachments: { name: string; url: string; kind: string }[];
  target_student_ids: number[];
  questions: unknown[];
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
  if (status === 'scheduled' && !publish_at) throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');

  const kind: HomeworkKind = raw.kind === 'quiz' ? 'quiz' : 'homework';
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (kind === 'quiz' && questions.length === 0) throw AppError.badRequest('Quiz cần ít nhất 1 câu hỏi');

  // Quiz: max_score tự tính từ tổng điểm câu hỏi (1 thang điểm duy nhất)
  let max_score: number | null = null;
  if (kind === 'quiz') {
    max_score = sumQuestionPoints(questions as { points?: number }[]);
  } else if (raw.max_score !== null && raw.max_score !== undefined && raw.max_score !== '') {
    max_score = Number(raw.max_score);
    if (!Number.isFinite(max_score) || max_score < 0) throw AppError.badRequest('Điểm tối đa không hợp lệ');
  }

  const attachments = Array.isArray(raw.attachments)
    ? (raw.attachments as { name: string; url: string; kind: string }[]).filter((a) => a && a.name && a.url)
    : [];
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
    attachments,
    target_student_ids,
    questions,
  };
}

/**
 * Insert 1 bài tập + đính kèm + targets trong transaction do caller cung cấp.
 * Dùng chung cho createHomeworkBatch và reuseHomework (P0-3b: 1 transaction duy nhất).
 */
async function insertHomeworkTx(
  tx: Tx,
  data: {
    centerId: number | null;
    class_id: number;
    title: string;
    content?: string | null;
    due_date?: string | null;
    created_by: number;
    status: HomeworkStatus;
    publish_at?: string | null;
    max_score?: number | null;
    close_date?: string | null;
    kind: string;
    rubric_id?: number | null;
    attachments: { name: string; url: string; kind: string }[];
    target_student_ids: number[];
  }
): Promise<number> {
  const r = await tx
    .prepare(
      `INSERT INTO homework (center_id, class_id, title, content, due_date, created_by,
        status, publish_at, max_score, close_date, kind, rubric_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.centerId,
      data.class_id,
      data.title.trim(),
      data.content?.trim() || null,
      data.due_date || null,
      data.created_by,
      data.status,
      data.publish_at || null,
      data.max_score ?? null,
      data.close_date || null,
      data.kind,
      data.rubric_id ?? null
    );
  const hid = Number(r.lastInsertRowid);
  const attStmt = await tx.prepare(
    'INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, ?, ?, ?)'
  );
  for (const a of data.attachments) {
    if (a.name.trim() && a.url.trim())
      await attStmt.run(hid, a.name.trim(), a.url.trim(), a.kind || 'link');
  }
  const tgtStmt = await tx.prepare('INSERT INTO homework_targets (homework_id, student_id) VALUES (?, ?)');
  for (const sid of data.target_student_ids) await tgtStmt.run(hid, sid);
  return hid;
}

/** P0-3(a,c): quiz chỉ được đăng khi đã có ít nhất 1 câu hỏi (chặn quiz rỗng). */
async function requireQuizPublishable(id: number): Promise<void> {
  const hw = await homeworkRepo.findById(id);
  if (hw && hw.kind === 'quiz' && (await countQuizQuestions(id)) === 0) {
    throw AppError.badRequest('Quiz chưa có câu hỏi, không thể đăng');
  }
}

export async function createHomeworkBatch(input: CreateHomeworkInput): Promise<HomeworkRow[]> {
  const {
    class_ids,
    title,
    content,
    due_date,
    created_by,
    centerId,
    status = 'published',
    publish_at,
    max_score,
    close_date,
    kind = 'homework',
    rubric_id,
    attachments = [],
    target_student_ids = [],
  } = input;
  if (!class_ids.length) throw AppError.badRequest('Vui lòng chọn ít nhất 1 lớp học');
  if (!title.trim()) throw AppError.badRequest('Vui lòng nhập tiêu đề bài tập');
  if (!(HOMEWORK_STATUS as readonly string[]).includes(status))
    throw AppError.badRequest('Trạng thái không hợp lệ');
  const hwStatus = status as HomeworkStatus;
  if (hwStatus === 'scheduled' && !publish_at) throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');
  assertValidDates(due_date, close_date);

  // Validate rubric_id thuộc cùng center (chống cross-tenant linkage)
  if (rubric_id) {
    const rubric = await getRubric(rubric_id, centerId);
    if (!rubric) throw AppError.badRequest('Rubric không tồn tại hoặc không thuộc trung tâm này');
  }

  const created: HomeworkRow[] = [];
  await db.transaction(async (tx) => {
    for (const cid of class_ids) {
      const hid = await insertHomeworkTx(tx, {
        centerId,
        class_id: cid,
        title,
        content,
        due_date,
        created_by,
        status: hwStatus,
        publish_at,
        max_score,
        close_date,
        kind,
        rubric_id,
        attachments,
        target_student_ids,
      });
      created.push((await tx.prepare('SELECT * FROM homework WHERE id = ?').get(hid)) as HomeworkRow);
    }
  });
  // P0-3(d): KHÔNG emit HomeworkCreatedEvent ở đây nữa — route POST / emit sau khi
  // câu hỏi quiz đã lưu xong, listener không bao giờ thấy quiz chưa có câu hỏi.
  return created;
}

/** Lấy chi tiết bài tập kèm đính kèm + targets. */
export async function getHomeworkDetail(id: number): Promise<HomeworkRow | null> {
  const hw = (await db
    .prepare(
      'SELECT h.*, c.name as class_name FROM homework h JOIN classes c ON c.id = h.class_id WHERE h.id = ?'
    )
    .get(id)) as HomeworkRow | undefined;
  if (!hw) return null;
  hw.attachments = (await db
    .prepare('SELECT id, name, url, kind FROM homework_attachments WHERE homework_id = ?')
    .all(id)) as { id: number; name: string; url: string; kind: string }[];
  return hw;
}

/**
 * Tái sử dụng: copy bài tập cũ thành bản mới (Classroom: Reuse Post).
 * P0-3(b): tạo bài + copy câu hỏi + copy targets trong 1 TRANSACTION DUY NHẤT —
 * copy câu hỏi fail thì không còn bài mới 0 câu hỏi publish được.
 */
export async function reuseHomework(
  id: number,
  createdBy: number,
  centerId: number | null
): Promise<HomeworkRow[]> {
  const src = await getHomeworkDetail(id);
  if (!src) throw AppError.notFound('Không tìm thấy bài tập gốc');
  // P1-3: attachment loại file được COPY vật lý sang tên mới — bản copy sở hữu
  // file riêng, xóa bài gốc không làm bài copy mất file. Link giữ nguyên URL.
  // Copy lỗi (hiếm) → giữ URL cũ để bản nháp không mất tham chiếu (log ở helper).
  // Copy file là I/O nên làm TRƯỚC transaction (không rollback được).
  const attachments = (src.attachments || []).map((a) => ({
    name: a.name,
    url: a.kind === 'file' ? (copyUploadedFileByUrl(a.url) ?? a.url) : a.url,
    kind: a.kind,
  }));
  const targets = (await db
    .prepare('SELECT student_id FROM homework_targets WHERE homework_id = ?')
    .all(id)) as { student_id: number }[];
  let qs: { id: number; question: string; points: number }[] = [];
  let optsAll: { question_id: number; text: string; is_correct: number }[] = [];
  if (src.kind === 'quiz') {
    qs = (await db
      .prepare('SELECT id, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position')
      .all(id)) as { id: number; question: string; points: number }[];
    optsAll = (await db
      .prepare(
        `SELECT qo.question_id, qo.text, qo.is_correct
         FROM quiz_options qo JOIN quiz_questions qq ON qq.id = qo.question_id
         WHERE qq.homework_id = ? ORDER BY qo.question_id, qo.position`
      )
      .all(id)) as { question_id: number; text: string; is_correct: number }[];
  }
  const newId = await db.transaction(async (tx) => {
    const hid = await insertHomeworkTx(tx, {
      centerId,
      class_id: src.class_id,
      title: src.title,
      content: src.content,
      due_date: null, // reset hạn để người dùng đặt lại
      created_by: createdBy,
      status: 'draft' as const, // về nháp để chỉnh sửa trước khi đăng
      publish_at: null,
      max_score: src.max_score,
      close_date: null,
      kind: src.kind,
      rubric_id: src.rubric_id,
      attachments,
      target_student_ids: targets.map((t) => t.student_id),
    });
    if (src.kind === 'quiz') {
      const qStmt = await tx.prepare(
        'INSERT INTO quiz_questions (homework_id, position, question, points) VALUES (?, ?, ?, ?)'
      );
      const oStmt = await tx.prepare(
        'INSERT INTO quiz_options (question_id, position, text, is_correct) VALUES (?, ?, ?, ?)'
      );
      for (const [qi, q] of qs.entries()) {
        const qr = await qStmt.run(hid, qi, q.question, q.points);
        const nqid = Number(qr.lastInsertRowid);
        const opts = optsAll.filter((o) => o.question_id === q.id);
        for (const [oi, o] of opts.entries()) await oStmt.run(nqid, oi, o.text, o.is_correct);
      }
    }
    return hid;
  });
  // P0-3(d): emit SAU KHI mọi thứ (kể cả câu hỏi copy) đã lưu xong
  eventBus.emitSync(new HomeworkCreatedEvent(newId, centerId, 'draft', src.kind));
  return [(await db.prepare('SELECT * FROM homework WHERE id = ?').get(newId)) as HomeworkRow];
}

/** Xuất bản các bài đã hẹn giờ đến hạn (scheduler gọi mỗi phút).
 * So sánh theo giờ Việt Nam vì publish_at lưu từ input datetime-local (giờ local). */
export async function publishScheduled(): Promise<number> {
  const now = nowVNMinute();
  // UPDATE ... RETURNING: atomic — chỉ instance nào update thành công mới emit event
  // (chống 2 instance cùng publish → gửi Zalo trùng)
  const published = await homeworkRepo.publishDue(now);
  for (const hw of published) eventBus.emitSync(new HomeworkPublishedEvent(hw.id, hw.center_id));
  return published.length;
}

export async function updateHomework(
  id: number,
  data: {
    title: string;
    content?: string | null;
    due_date?: string | null;
    max_score?: number | null;
    close_date?: string | null;
    status?: 'draft' | 'scheduled' | 'published';
    publish_at?: string | null;
    rubric_id?: number | null;
  }
): Promise<HomeworkRow> {
  if (!data.title.trim()) throw AppError.badRequest('Vui lòng nhập tiêu đề bài tập');
  // P0-1: merge với ngày hiện tại trong DB trước khi check cặp ngày.
  // Route truyền undefined cho field không gửi (không reset về null) → tránh
  // lọt close_date < due_date khi client chỉ gửi 1 field.
  const current = (await db
    .prepare('SELECT due_date, close_date, kind, max_score FROM homework WHERE id = ?')
    .get(id)) as {
    due_date: string | null;
    close_date: string | null;
    kind: string;
    max_score: number | null;
  } | undefined;
  if (!current) throw AppError.notFound('Không tìm thấy bài tập');
  const due_date = data.due_date !== undefined ? data.due_date : current.due_date;
  const close_date = data.close_date !== undefined ? data.close_date : current.close_date;
  // Validate format + logic ngày (date có thật, close_date sau due_date)
  assertValidDates(due_date, close_date);
  if (data.status === 'scheduled' && !data.publish_at) {
    throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');
  }
  // Validate status enum (tránh DB CHECK ném 500)
  const status = data.status || 'published';
  if (!['draft', 'scheduled', 'published'].includes(status)) {
    throw AppError.badRequest('Trạng thái bài tập không hợp lệ');
  }
  // P0-3(c): PUT đổi status sang published cũng phải có câu hỏi (như nút Đăng)
  if (status === 'published') await requireQuizPublishable(id);
  // Validate max_score > 0
  const maxScore = data.max_score ?? null;
  if (maxScore !== null && (!Number.isFinite(maxScore) || maxScore <= 0)) {
    throw AppError.badRequest('Điểm tối đa phải lớn hơn 0');
  }
  // Chặn hạ max_score dưới điểm cao nhất đã chấm
  if (maxScore !== null) {
    const top = (await db
      .prepare('SELECT MAX(score) as m FROM homework_scores WHERE homework_id = ?')
      .get(id)) as { m: number | null };
    if (top.m !== null && maxScore < top.m) {
      throw AppError.badRequest(`Không thể hạ điểm tối đa xuống dưới điểm đã chấm (${top.m})`);
    }
  }
  await db
    .prepare(
      `UPDATE homework SET title = ?, content = ?, due_date = ?,
       max_score = ?, close_date = ?, status = ?, publish_at = ?, rubric_id = ?
     WHERE id = ?`
    )
    .run(
      data.title.trim(),
      data.content?.trim() || null,
      due_date || null,
      maxScore,
      close_date || null,
      status,
      data.publish_at || null,
      data.rubric_id ?? null,
      id
    );
  return (await db.prepare('SELECT * FROM homework WHERE id = ?').get(id)) as HomeworkRow;
}

export async function deleteHomework(id: number, centerId: number | null = null): Promise<void> {
  await deleteHomeworkCascade(id);
  eventBus.emitSync(new HomeworkDeletedEvent(id, centerId));
}

/** Đánh dấu học viên đã hoàn thành bài tập. */
/** Đặt trạng thái đăng/gỡ đăng cho bài tập (publish/unpublish). */
export async function setHomeworkStatus(
  id: number,
  status: 'published' | 'draft',
  centerId: number | null = null
): Promise<void> {
  // P0-3(a): đăng quiz rỗng → 400
  if (status === 'published') await requireQuizPublishable(id);
  await homeworkRepo.setStatus(id, status);
  if (status === 'published') {
    eventBus.emitSync(new HomeworkPublishedEvent(id, centerId));
  } else {
    eventBus.emitSync(new HomeworkUnpublishedEvent(id, centerId));
  }
}

/** Lấy thông tin lớp tối thiểu để kiểm tra scope. */
export async function getClassScope(
  id: number
): Promise<{ id: number; center_id: number | null; teacher_id: number | null } | null> {
  const row = (await db.prepare('SELECT id, center_id, teacher_id FROM classes WHERE id = ?').get(id)) as
    { id: number; center_id: number | null; teacher_id: number | null } | undefined;
  return row ?? null;
}

/** Lấy bài tập kèm thông tin scope của lớp (để route kiểm tra quyền). */
export async function getHomeworkWithScope(
  id: number
): Promise<(HomeworkRow & { class_center_id: number | null; teacher_id: number | null }) | null> {
  return await homeworkRepo.findWithScope(id);
}

/** Lọc target students hợp lệ (thuộc các lớp được chọn và đang học). */
export async function filterValidTargets(classIds: number[], targetStudentIds: unknown[]): Promise<number[]> {
  const tids = (targetStudentIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!tids.length || !classIds.length) return [];
  const placeholders = classIds.map(() => '?').join(',');
  const rows = (await db
    .prepare(
      `SELECT DISTINCT student_id FROM enrollments
       WHERE class_id IN (${placeholders}) AND student_id IN (${tids.map(() => '?').join(',')}) AND status = 'active'`
    )
    .all(...classIds, ...tids)) as { student_id: number }[];
  return rows.map((r) => r.student_id);
}

/** Danh sách bài nộp của 1 bài tập (staff xem) — có phân trang. */
export async function getHomeworkSubmissions(
  id: number,
  pageOpts: { page?: number; limit?: number } = {}
): Promise<Paginated<unknown>> {
  const { page, limit, offset } = parsePagination(pageOpts);
  const totalRow = (await db
    .prepare('SELECT COUNT(*) as c FROM homework_submissions WHERE homework_id = ?')
    .get(id)) as { c: string };
  const total = Number(totalRow?.c) || 0;
  const rows = await db
    .prepare(
      `SELECT hs.*, s.name as student_name FROM homework_submissions hs
       JOIN students s ON s.id = hs.student_id
       WHERE hs.homework_id = ? ORDER BY hs.submitted_at DESC LIMIT ? OFFSET ?`
    )
    .all(id, limit, offset);
  return paginate(rows, total, page, limit);
}

/* --------------------------------- Chấm điểm --------------------------------- */

/** Chấm điểm bài tập thường (tay hoặc theo rubric).
 * - Bọc transaction: điểm + đánh dấu hoàn thành là 1 đơn vị nguyên tử.
 * - Kiểm tra học viên thuộc lớp của bài tập (chống điểm "mồ côi"). */
export async function gradeHomework(
  homeworkId: number,
  studentId: number,
  score: number | null,
  feedback: string | null,
  gradedBy: number | null
): Promise<void> {
  const hw = (await db.prepare('SELECT class_id, max_score FROM homework WHERE id = ?').get(homeworkId)) as
    { class_id: number; max_score: number | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  // Chặn điểm vượt quá điểm tối đa (gõ nhầm 15/10)
  if (score !== null) {
    if (score < 0) throw AppError.badRequest('Điểm không được âm');
    if (hw.max_score != null && score > hw.max_score) {
      throw AppError.badRequest(`Điểm không được vượt quá ${hw.max_score}`);
    }
  }
  // Học viên phải đang học lớp của bài tập (hoặc nằm trong danh sách giao riêng)
  const enrolled = await db
    .prepare(`SELECT 1 FROM enrollments WHERE student_id = ? AND class_id = ? AND status = 'active'`)
    .get(studentId, hw.class_id);
  if (!enrolled) {
    const targeted = await db
      .prepare('SELECT 1 FROM homework_targets WHERE homework_id = ? AND student_id = ?')
      .get(homeworkId, studentId);
    if (!targeted) throw AppError.badRequest('Học viên không thuộc lớp của bài tập này');
  }
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO homework_scores (homework_id, student_id, score, feedback, graded_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(homework_id, student_id)
       DO UPDATE SET score = ?, feedback = ?, graded_at = datetime('now'), graded_by = ?`
      )
      .run(homeworkId, studentId, score, feedback, gradedBy, score, feedback, gradedBy);
    if (score !== null) {
      await tx
        .prepare(
          `INSERT INTO homework_completions (homework_id, student_id, completed_by)
         VALUES (?, ?, 'teacher') ON CONFLICT(homework_id, student_id) DO NOTHING`
        )
        .run(homeworkId, studentId);
    }
  });
  eventBus.emitSync(new HomeworkGradedEvent(homeworkId, studentId, score, gradedBy));
}

/** Bảng điểm của 1 bài tập: từng học viên + điểm + trạng thái. */
export interface HomeworkScoreRow {
  student_id: number;
  student_name: string;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  completed: number;
  quiz_score: number | null;
}

export async function getHomeworkScores(homeworkId: number): Promise<HomeworkScoreRow[]> {
  return (await db
    .prepare(
      `SELECT s.id as student_id, s.name as student_name,
        hs.score, hs.feedback, hs.graded_at,
        CASE WHEN hc.id IS NOT NULL THEN 1 ELSE 0 END as completed,
        (SELECT score FROM quiz_attempts qa
         WHERE qa.homework_id = ? AND qa.student_id = s.id
         ORDER BY qa.submitted_at DESC LIMIT 1) as quiz_score
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       LEFT JOIN homework_scores hs ON hs.homework_id = ? AND hs.student_id = s.id
       LEFT JOIN homework_completions hc ON hc.homework_id = ? AND hc.student_id = s.id
       WHERE e.class_id = (SELECT class_id FROM homework WHERE id = ?)
         AND e.status = 'active'
         AND (NOT EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ?)
              OR EXISTS (SELECT 1 FROM homework_targets ht WHERE ht.homework_id = ? AND ht.student_id = s.id))
       ORDER BY s.name`
    )
    .all(homeworkId, homeworkId, homeworkId, homeworkId, homeworkId, homeworkId)) as HomeworkScoreRow[];
}

/** Điểm của 1 học viên cho 1 bài (parent view). */
export async function getStudentScore(
  homeworkId: number,
  studentId: number
): Promise<{ score: number | null; feedback: string | null; max_score: number | null } | null> {
  const hw = (await db.prepare('SELECT max_score FROM homework WHERE id = ?').get(homeworkId)) as
    { max_score: number | null } | undefined;
  if (!hw) return null;
  const s = (await db
    .prepare('SELECT score, feedback FROM homework_scores WHERE homework_id = ? AND student_id = ?')
    .get(homeworkId, studentId)) as { score: number | null; feedback: string | null } | undefined;
  return { score: s?.score ?? null, feedback: s?.feedback ?? null, max_score: hw.max_score };
}

/* --------------------------------- Analytics --------------------------------- */

/** Phân tích tổng quan bài tập: hoàn thành, điểm TB theo lớp. */
export async function getHomeworkAnalytics(ctx: ScopeCtx): Promise<{
  byClass: {
    class_id: number;
    class_name: string;
    total: number;
    avg_completion: number;
    avg_score: number | null;
  }[];
  recent: { id: number; title: string; class_name: string; completion_rate: number }[];
}> {
  const params: unknown[] = [];
  const conds = scopeConds(ctx, params);
  const from = `FROM homework h JOIN classes c ON c.id = h.class_id`;
  const where = `WHERE ${conds.join(' AND ')} AND h.status = 'published'`;

  // Mẫu số: số học viên được giao (target riêng) hoặc cả lớp
  const denominator = assignedCountExpr('h', 'h');

  const byClass = (await db
    .prepare(
      `SELECT c.id as class_id, c.name as class_name,
        COUNT(DISTINCT h.id) as total,
        COALESCE(AVG(
          (SELECT COUNT(*) FROM homework_completions hc WHERE hc.homework_id = h.id) * 1.0 /
          NULLIF(${denominator}, 0)
        ), 0) as avg_completion,
        (SELECT AVG(hs.score) FROM homework_scores hs
         JOIN homework h2 ON h2.id = hs.homework_id
         WHERE h2.class_id = c.id AND hs.score IS NOT NULL) as avg_score
       ${from} ${where} GROUP BY c.id, c.name ORDER BY c.name`
    )
    .all(...params)) as {
    class_id: number;
    class_name: string;
    total: number;
    avg_completion: number;
    avg_score: number | null;
  }[];

  const recent = (await db
    .prepare(
      `SELECT h.id, h.title, c.name as class_name,
        COALESCE(
          (SELECT COUNT(*) FROM homework_completions hc WHERE hc.homework_id = h.id) * 100.0 /
          NULLIF(${denominator}, 0), 0
        ) as completion_rate
       ${from} ${where} ORDER BY h.id DESC LIMIT 10`
    )
    .all(...params)) as { id: number; title: string; class_name: string; completion_rate: number }[];

  return { byClass, recent };
}
