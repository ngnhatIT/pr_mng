import { db } from '../../db';
import type { Tx } from '../../db';
import type { ScopeCtx } from '../../shared/scope';
import { countQuizQuestions, insertQuizQuestionsTx, type NormalizedQuizQuestion } from './quiz.service';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { DAY_MS } from '../../shared/time';
import { AppError } from '../../shared/errors';
import {
  nowVNMinute,
  assertValidDates,
  sumQuestionPoints,
  normalizeQtype,
  scopeConds,
} from './homework.helpers';
import { todayVN } from '../../shared/vnTime';
import { homeworkRepo, deleteHomeworkCascade } from './homework.repo';
import { eventBus } from '../../shared/events/eventBus';
import { escapeLike } from '../../shared/like';
import { copyUploadedFileByUrl, deleteUploadFileByUrl, recordUpload } from '../../shared/upload';
import { getRubric } from './rubric.service';
import {
  HomeworkCreatedEvent,
  HomeworkPublishedEvent,
  HomeworkUnpublishedEvent,
  HomeworkDeletedEvent,
} from '../../shared/events/homework.events';
import {
  HOMEWORK_STATUS,
  type HomeworkRow,
  type HomeworkQuery,
  type CreateHomeworkInput,
  type HomeworkStatus,
} from './homework.types';
import { validateAttachmentInputs, parseMaxAttempts, type HomeworkAttachmentInput } from './homework.input';

/* B3-3: kiểu, validate input, chấm điểm tách file riêng — re-export để importer cũ không đổi. */
export * from './homework.types';
export * from './homework.input';
export * from './homework.grading';

/* --------------------------------- Helpers --------------------------------- */

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
  // HW-13: phân trang id TRƯỚC (CTE p), rồi đếm bằng subquery gộp sẵn theo homework_id
  // chỉ cho ≤ limit bài của trang — không còn fan-out completions × targets × enrollments
  // × questions trên toàn bộ bài trong scope. student_count giữ ngữ nghĩa assignedCountExpr:
  // có target riêng → đếm target, không có → đếm học viên đang học của lớp.
  const rows = (await db
    .prepare(
      `WITH p AS (SELECT h.id ${from} ${where} ORDER BY h.id DESC LIMIT ? OFFSET ?)
       SELECT h.*, c.name as class_name,
        COALESCE(hc.n, 0) as completed_count,
        COALESCE(NULLIF(ht.n, 0), en.n, 0) as student_count,
        COALESCE(qq.n, 0) as question_count
       FROM p JOIN homework h ON h.id = p.id JOIN classes c ON c.id = h.class_id
       LEFT JOIN (SELECT homework_id, COUNT(*) as n FROM homework_completions
                  WHERE homework_id IN (SELECT id FROM p) GROUP BY homework_id) hc ON hc.homework_id = h.id
       LEFT JOIN (SELECT homework_id, COUNT(DISTINCT student_id) as n FROM homework_targets
                  WHERE homework_id IN (SELECT id FROM p) GROUP BY homework_id) ht ON ht.homework_id = h.id
       LEFT JOIN (SELECT class_id, COUNT(DISTINCT student_id) as n FROM enrollments
                  WHERE status = 'active' AND class_id IN (SELECT h2.class_id FROM homework h2 JOIN p ON p.id = h2.id)
                  GROUP BY class_id) en ON en.class_id = h.class_id
       LEFT JOIN (SELECT homework_id, COUNT(*) as n FROM quiz_questions
                  WHERE homework_id IN (SELECT id FROM p) GROUP BY homework_id) qq ON qq.homework_id = h.id
       ORDER BY h.id DESC`
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
    max_attempts?: number | null;
    attachments: { name: string; url: string; kind: string }[];
    target_student_ids: number[];
  }
): Promise<number> {
  const r = await tx
    .prepare(
      `INSERT INTO homework (center_id, class_id, title, content, due_date, created_by,
        status, publish_at, max_score, close_date, kind, rubric_id, max_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      data.rubric_id ?? null,
      data.kind === 'quiz' ? (data.max_attempts ?? null) : null
    );
  const hid = Number(r.lastInsertRowid);
  const attStmt = await tx.prepare(
    'INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, ?, ?, ?)'
  );
  for (const a of data.attachments) {
    if (a.name.trim() && a.url.trim()) await attStmt.run(hid, a.name.trim(), a.url.trim(), a.kind || 'link');
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

/**
 * HW-6: file /uploads gắn vào bài phải nằm trong sổ uploads của trung tâm người gọi
 * (superadmin: bất kỳ), hoặc đã gắn sẵn vào chính bài này (sửa bài có file cũ).
 * Chặn gắn file của trung tâm khác/bài nộp của học viên rồi gỡ ra để xóa file đó.
 */
async function assertAttachableUploads(
  attachments: HomeworkAttachmentInput[],
  centerId: number | null,
  homeworkId: number | null
): Promise<void> {
  for (const a of attachments) {
    if (a.kind !== 'file') continue;
    if (
      homeworkId !== null &&
      (await db
        .prepare('SELECT 1 FROM homework_attachments WHERE homework_id = ? AND url = ?')
        .get(homeworkId, a.url))
    ) {
      continue;
    }
    const up = (await db
      .prepare('SELECT center_id FROM uploads WHERE filename = ?')
      .get(a.url.slice('/uploads/'.length))) as { center_id: number | null } | undefined;
    if (!up || (centerId !== null && up.center_id !== centerId)) {
      throw AppError.badRequest(`File đính kèm "${a.name}" không hợp lệ hoặc không thuộc trung tâm này`);
    }
  }
}

/**
 * Tạo bài tập cho NHIỀU lớp cùng lúc (1 lần giao cho nhiều lớp).
 * Hỗ trợ: draft/scheduled, điểm số, hạn chót, quiz, rubric, đính kèm, giao riêng.
 */
export async function createHomeworkBatch(
  input: CreateHomeworkInput & { questions?: NormalizedQuizQuestion[] }
): Promise<HomeworkRow[]> {
  const {
    class_ids,
    title,
    content,
    due_date,
    created_by,
    centerId,
    status = 'published',
    publish_at,
    close_date,
    kind = 'homework',
    rubric_id,
    max_attempts,
    attachments = [],
    target_student_ids = [],
    questions = [],
  } = input;
  if (!class_ids.length) throw AppError.badRequest('Vui lòng chọn ít nhất 1 lớp học');
  if (!title.trim()) throw AppError.badRequest('Vui lòng nhập tiêu đề bài tập');
  if (!(HOMEWORK_STATUS as readonly string[]).includes(status))
    throw AppError.badRequest('Trạng thái không hợp lệ');
  const hwStatus = status as HomeworkStatus;
  if (hwStatus === 'scheduled' && !publish_at) throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');
  assertValidDates(due_date, close_date);
  // HW-12: quiz có đề thì max_score = tổng điểm đề (như saveQuizQuestions)
  const max_score = kind === 'quiz' && questions.length ? sumQuestionPoints(questions) : input.max_score;

  // Validate rubric_id thuộc cùng center (chống cross-tenant linkage)
  if (rubric_id) {
    const rubric = await getRubric(rubric_id, centerId);
    if (!rubric) throw AppError.badRequest('Rubric không tồn tại hoặc không thuộc trung tâm này');
  }
  await assertAttachableUploads(attachments, centerId, null);

  // HW-9: target riêng lọc THEO TỪNG LỚP (học viên đang học lớp đó). Có chọn target mà
  // lớp không còn ai → bỏ lớp đó (không giao bài "vô chủ" cho học viên lớp khác).
  const tids = [...new Set(target_student_ids)];
  const plan: { class_id: number; targets: number[] }[] = [];
  for (const cid of class_ids) {
    if (!tids.length) {
      plan.push({ class_id: cid, targets: [] });
      continue;
    }
    const rows = (await db
      .prepare(
        `SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'
         AND student_id IN (${tids.map(() => '?').join(',')})`
      )
      .all(cid, ...tids)) as { student_id: number }[];
    const targets = [...new Set(rows.map((r) => r.student_id))];
    if (targets.length) plan.push({ class_id: cid, targets });
  }
  if (!plan.length) throw AppError.badRequest('Học viên được chọn không thuộc lớp nào đã chọn');

  // HW-3: mỗi lớp sở hữu file riêng (như reuseHomework) — xóa/sửa bài lớp này không làm
  // lớp khác mất file. Lớp đầu dùng file gốc, các lớp sau dùng bản copy (ghi sổ uploads để
  // sweeper dọn nếu transaction lỗi). Copy là I/O nên làm TRƯỚC transaction.
  const perClassAttachments: HomeworkAttachmentInput[][] = [];
  for (let i = 0; i < plan.length; i++) {
    if (i === 0) {
      perClassAttachments.push(attachments);
      continue;
    }
    const copied: HomeworkAttachmentInput[] = [];
    for (const a of attachments) {
      const url = a.kind === 'file' ? copyUploadedFileByUrl(a.url) : null;
      if (url) await recordUpload(url, centerId, created_by);
      copied.push({ ...a, url: url ?? a.url });
    }
    perClassAttachments.push(copied);
  }

  const created: HomeworkRow[] = [];
  await db.transaction(async (tx) => {
    for (const [i, p] of plan.entries()) {
      const hid = await insertHomeworkTx(tx, {
        centerId,
        class_id: p.class_id,
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
        max_attempts,
        attachments: perClassAttachments[i],
        target_student_ids: p.targets,
      });
      // HW-12: câu hỏi quiz ghi trong CÙNG transaction — không có quiz đã đăng mà 0 câu hỏi
      if (kind === 'quiz' && questions.length) await insertQuizQuestionsTx(tx, hid, questions);
      created.push((await tx.prepare('SELECT * FROM homework WHERE id = ?').get(hid)) as HomeworkRow);
    }
  });
  // P0-3(d): KHÔNG emit HomeworkCreatedEvent ở đây nữa — route POST / emit sau khi
  // transaction (kể cả câu hỏi quiz) commit, listener không bao giờ thấy quiz chưa có câu hỏi.
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
  const attachments: HomeworkAttachmentInput[] = [];
  for (const a of src.attachments || []) {
    const copy = a.kind === 'file' ? copyUploadedFileByUrl(a.url) : null;
    if (copy) await recordUpload(copy, centerId, createdBy); // sweeper dọn nếu transaction lỗi
    attachments.push({ name: a.name, url: copy ?? a.url, kind: a.kind });
  }
  const targets = (await db
    .prepare('SELECT student_id FROM homework_targets WHERE homework_id = ?')
    .all(id)) as { student_id: number }[];
  let qs: { id: number; qtype: string; question: string; points: number }[] = [];
  let optsAll: { question_id: number; text: string; is_correct: number }[] = [];
  if (src.kind === 'quiz') {
    qs = (await db
      .prepare(
        'SELECT id, qtype, question, points FROM quiz_questions WHERE homework_id = ? ORDER BY position'
      )
      .all(id)) as { id: number; qtype: string; question: string; points: number }[];
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
      max_attempts: src.max_attempts,
      attachments,
      target_student_ids: targets.map((t) => t.student_id),
    });
    if (src.kind === 'quiz') {
      await insertQuizQuestionsTx(
        tx,
        hid,
        qs.map((q) => ({
          question: q.question,
          points: q.points,
          qtype: normalizeQtype(q.qtype),
          options: optsAll
            .filter((o) => o.question_id === q.id)
            .map((o) => ({ text: o.text, is_correct: !!Number(o.is_correct) })),
        }))
      );
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
    /** HW-1: mọi field dưới đây undefined = GIỮ NGUYÊN giá trị trong DB (client không gửi) */
    content?: string | null;
    due_date?: string | null;
    max_score?: number | null;
    close_date?: string | null;
    status?: HomeworkStatus;
    publish_at?: string | null;
    rubric_id?: number | null;
    /** C-1: chỉ áp dụng quiz; null = không giới hạn */
    max_attempts?: number | null;
    /** undefined = giữ nguyên đính kèm cũ; mảng = đồng bộ theo danh sách mới */
    attachments?: { name: string; url: string; kind: string }[];
  },
  centerId: number | null = null
): Promise<HomeworkRow> {
  if (!data.title.trim()) throw AppError.badRequest('Vui lòng nhập tiêu đề bài tập');
  const current = (await db.prepare('SELECT * FROM homework WHERE id = ?').get(id)) as
    HomeworkRow | undefined;
  if (!current) throw AppError.notFound('Không tìm thấy bài tập');
  const keep = <T>(v: T | undefined, cur: T): T => (v !== undefined ? v : cur);
  // P0-1: merge với ngày hiện tại trong DB trước khi check cặp ngày
  const due_date = keep(data.due_date, current.due_date);
  const close_date = keep(data.close_date, current.close_date);
  assertValidDates(due_date, close_date);
  // HW-1: không gửi status → giữ trạng thái cũ (trước đây mặc định 'published' làm
  // sửa tiêu đề bài nháp/hẹn giờ là đăng luôn và mất lịch hẹn)
  const status = keep(data.status, current.status);
  if (!(HOMEWORK_STATUS as readonly string[]).includes(status)) {
    throw AppError.badRequest('Trạng thái bài tập không hợp lệ');
  }
  // Hẹn giờ chỉ có nghĩa khi status = scheduled (như setStatus: đăng/gỡ đăng xóa lịch hẹn)
  const publish_at = status === 'scheduled' ? keep(data.publish_at, current.publish_at) : null;
  if (status === 'scheduled' && !publish_at) {
    throw AppError.badRequest('Hẹn giờ đăng cần chọn thời gian');
  }
  // P0-3(c): PUT đổi status sang published cũng phải có câu hỏi (như nút Đăng)
  if (status === 'published') await requireQuizPublishable(id);
  let maxScore = keep(data.max_score, current.max_score);
  if (current.kind === 'quiz') {
    // P1-11: quiz có 1 thang điểm duy nhất = tổng điểm đề (đồng bộ với
    // saveQuizQuestions) — PUT không được set max_score tùy ý gây lệch tổng đề.
    // Đề trống thì giữ nguyên điểm cũ (tránh 400 oan khi chỉ sửa tiêu đề).
    const total = (await db
      .prepare('SELECT COALESCE(SUM(points), 0) as t FROM quiz_questions WHERE homework_id = ?')
      .get(id)) as { t: number };
    maxScore = total.t > 0 ? total.t : current.max_score;
  }
  if (maxScore !== null && (!Number.isFinite(maxScore) || maxScore <= 0)) {
    throw AppError.badRequest('Điểm tối đa phải lớn hơn 0');
  }
  // P1-1: rubric mới phải thuộc cùng center (như lúc tạo) — chặn cross-tenant linkage
  const rubricId = keep(data.rubric_id, current.rubric_id);
  if (data.rubric_id !== undefined && rubricId !== null) {
    const rubric = await getRubric(rubricId, centerId);
    if (!rubric) throw AppError.badRequest('Rubric không tồn tại hoặc không thuộc trung tâm này');
  }
  const content = data.content !== undefined ? data.content?.trim() || null : current.content;
  const maxAttempts =
    current.kind === 'quiz' ? keep(parseMaxAttempts(data.max_attempts), current.max_attempts) : null;
  // Chặn hạ max_score dưới điểm cao nhất đã chấm
  if (maxScore !== null) {
    const top = (await db
      .prepare('SELECT MAX(score) as m FROM homework_scores WHERE homework_id = ?')
      .get(id)) as { m: number | null };
    if (top.m !== null && maxScore < top.m) {
      throw AppError.badRequest(`Không thể hạ điểm tối đa xuống dưới điểm đã chấm (${top.m})`);
    }
  }
  // Validate đính kèm TRƯỚC khi ghi (lỗi thì không sửa nửa vời)
  const nextAttachments = data.attachments !== undefined ? validateAttachmentInputs(data.attachments) : null;
  if (nextAttachments) await assertAttachableUploads(nextAttachments, centerId, id);
  await db
    .prepare(
      `UPDATE homework SET title = ?, content = ?, due_date = ?,
       max_score = ?, close_date = ?, status = ?, publish_at = ?, rubric_id = ?, max_attempts = ?
     WHERE id = ?`
    )
    .run(
      data.title.trim(),
      content,
      due_date || null,
      maxScore,
      close_date || null,
      status,
      publish_at || null,
      rubricId,
      maxAttempts,
      id
    );
  // YC1: đồng bộ đính kèm khi sửa (thêm mới / xóa cái đã gỡ khỏi form)
  if (nextAttachments) await syncAttachments(id, nextAttachments);
  // HW-1: chuyển sang/ra khỏi published qua PUT cũng phát sự kiện như nút Đăng/Gỡ đăng (Zalo)
  if (status === 'published' && current.status !== 'published') {
    eventBus.emitSync(new HomeworkPublishedEvent(id, centerId));
  } else if (status !== 'published' && current.status === 'published') {
    eventBus.emitSync(new HomeworkUnpublishedEvent(id, centerId));
  }
  return (await db.prepare('SELECT * FROM homework WHERE id = ?').get(id)) as HomeworkRow;
}

/**
 * Đồng bộ đính kèm của bài tập theo danh sách mới từ form:
 * thêm dòng mới, xóa dòng đã gỡ. File vật lý của đính kèm loại 'file'
 * bị gỡ được xóa khỏi đĩa (best-effort, sau khi transaction commit).
 */
async function syncAttachments(id: number, next: HomeworkAttachmentInput[]): Promise<void> {
  const current = (await db
    .prepare('SELECT id, url FROM homework_attachments WHERE homework_id = ?')
    .all(id)) as { id: number; url: string }[];
  const keepUrls = new Set(next.map((a) => a.url));
  const currentUrls = new Set(current.map((c) => c.url));
  const removedUrls: string[] = [];
  await db.transaction(async (tx) => {
    const delStmt = await tx.prepare('DELETE FROM homework_attachments WHERE id = ?');
    for (const c of current) {
      if (!keepUrls.has(c.url)) {
        await delStmt.run(c.id);
        removedUrls.push(c.url);
      }
    }
    const insStmt = await tx.prepare(
      'INSERT INTO homework_attachments (homework_id, name, url, kind) VALUES (?, ?, ?, ?)'
    );
    for (const a of next) {
      if (!currentUrls.has(a.url)) await insStmt.run(id, a.name, a.url, a.kind);
    }
  });
  // Dọn file vật lý của đính kèm đã gỡ (không chặn nếu xóa lỗi; file còn bài khác dùng thì giữ — HW-3)
  for (const u of removedUrls) await deleteUploadFileByUrl(u);
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
