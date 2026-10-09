import bcrypt from 'bcryptjs';
import { db, toISODate, confirmedPaid, getCenterSetting, formatSchedule } from '../../db';
import { AuthUser, DUMMY_PASSWORD_HASH } from '../../middleware/auth';
import { issueTokenPair, TokenPair } from '../auth/refresh.service';
import { ensureParentReferralCode } from '../../services/referrals';
import { buildVnpayUrl } from '../../services/vnpay';
import { normalizePhone } from '../../services/zalo';
import { AppError } from '../../shared/errors';
import { targetScopeCond } from '../homework/homework.helpers';

/* ---------------------------------- Types ---------------------------------- */

export interface ParentRow {
  id: number;
  center_id: number | null;
  phone: string;
  password_hash: string;
  name: string;
  referral_code: string | null;
}

export interface ParentPublic {
  id: number;
  phone: string;
  name: string;
  referral_code: string | null;
  center_id: number | null;
}

export interface LinkedStudent {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  center_id: number | null;
}

export interface ChildSummary extends LinkedStudent {
  dob: string | null;
  status: string;
  classes: { id: number; name: string }[];
}

/* --------------------------------- Helpers --------------------------------- */

async function issueTokenPairForParent(p: ParentPublic): Promise<TokenPair> {
  const payload: AuthUser = {
    id: p.id,
    username: p.phone,
    role: 'parent',
    kind: 'parent', // C1: namespace id — id này là parents.id, KHÔNG phải users.id
    name: p.name,
    center_id: p.center_id,
    parent_id: p.id,
  };
  return issueTokenPair(payload);
}

/** Học viên phải thuộc parent (chống xem trộm con người khác). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getLinkedStudent(parentId: number, studentId: number): Promise<LinkedStudent> {
  const student = (await db
    .prepare(
      `SELECT s.* FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_id = ? AND s.id = ?`
    )
    .get(parentId, studentId)) as LinkedStudent | undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên');
  return student;
}

/** Hóa đơn phải thuộc con của parent. */
async function getParentInvoice(
  parentId: number,
  invoiceId: number
): Promise<{ id: number; amount: number; status: string; center_id: number | null }> {
  const inv = (await db
    .prepare(
      `SELECT i.*, s.center_id
       FROM invoices i
       JOIN parent_students ps ON ps.student_id = i.student_id
       JOIN students s ON s.id = i.student_id
       WHERE i.id = ? AND ps.parent_id = ?`
    )
    .get(invoiceId, parentId)) as
    { id: number; amount: number; status: string; center_id: number | null } | undefined;
  if (!inv) throw AppError.notFound('Không tìm thấy hóa đơn');
  return inv;
}

/** Số tiền còn nợ của hóa đơn — ném 400 nếu đã thanh toán đủ. */
async function remainingOrThrow(invoiceId: number, amount: number): Promise<number> {
  const remaining = Math.round(amount - (await confirmedPaid(invoiceId)));
  if (remaining <= 0) throw AppError.badRequest('Hóa đơn đã thanh toán đủ');
  return remaining;
}

async function creditSummary(parentId: number): Promise<{ total: number; used: number; available: number }> {
  const cr = (await db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) as total, COALESCE(SUM(used_amount),0) as used FROM credits WHERE parent_id = ?'
    )
    .get(parentId)) as { total: number; used: number };
  return { total: cr.total, used: cr.used, available: cr.total - cr.used };
}

/* ------------------------------- Auth phụ huynh ------------------------------- */

export async function registerParent(input: {
  phone?: string;
  password?: string;
  name?: string;
  center_id?: number;
}): Promise<TokenPair & { parent: ParentPublic }> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) throw AppError.badRequest('Số điện thoại không hợp lệ');
  if (!input.password || input.password.length < 4)
    throw AppError.badRequest('Mật khẩu phải có ít nhất 4 ký tự');
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Vui lòng nhập họ tên');

  // M3: bắt buộc center_id (client gửi), KHÔNG dùng center mặc định — chống tạo nhầm tenant
  const centerId = Number(input.center_id);
  if (!Number.isInteger(centerId) || centerId <= 0) throw AppError.badRequest('Thiếu trung tâm đăng ký');
  const center = (await db.prepare('SELECT id FROM centers WHERE id = ?').get(centerId)) as
    { id: number } | undefined;
  if (!center) throw AppError.badRequest('Trung tâm không tồn tại');

  const exists = await db
    .prepare('SELECT id FROM parents WHERE center_id = ? AND phone = ?')
    .get(center.id, normalized);
  if (exists) throw AppError.conflict('Số điện thoại này đã được đăng ký');

  const hash = bcrypt.hashSync(input.password, 10);
  const r = await db
    .prepare('INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, ?, ?, ?)')
    .run(center.id, normalized, hash, name);
  const parentId = Number(r.lastInsertRowid);
  const parent: ParentPublic = {
    id: parentId,
    phone: normalized,
    name,
    referral_code: await ensureParentReferralCode(parentId),
    center_id: center.id,
  };
  return { ...(await issueTokenPairForParent(parent)), parent };
}

export async function loginParent(input: {
  phone?: string;
  password?: string;
  center_id?: number;
}): Promise<TokenPair & { parent: ParentPublic }> {
  const normalized = normalizePhone(input.phone);
  if (!normalized || !input.password) throw AppError.badRequest('Vui lòng nhập số điện thoại và mật khẩu');

  // M3: tìm parent theo phone trên đúng center client gửi (nếu có); không dùng center mặc định
  const centerId = input.center_id !== undefined ? Number(input.center_id) : undefined;
  if (centerId !== undefined && (!Number.isInteger(centerId) || centerId <= 0))
    throw AppError.badRequest('Trung tâm không hợp lệ');
  const rows = (await db
    .prepare('SELECT * FROM parents WHERE phone = ?' + (centerId !== undefined ? ' AND center_id = ?' : ''))
    .all(...(centerId !== undefined ? [normalized, centerId] : [normalized]))) as ParentRow[];
  if (rows.length > 1)
    throw AppError.badRequest('Số điện thoại này tồn tại ở nhiều trung tâm, vui lòng chọn trung tâm');
  const parent = rows[0];
  // M6: luôn chạy bcrypt.compare (kể cả khi user không tồn tại) để chống timing side-channel
  const hashToCheck = parent ? parent.password_hash : DUMMY_PASSWORD_HASH;
  const ok = bcrypt.compareSync(input.password, hashToCheck);
  if (!parent || !ok) {
    throw AppError.unauthorized('Số điện thoại hoặc mật khẩu không đúng');
  }
  const out: ParentPublic = {
    id: parent.id,
    phone: parent.phone,
    name: parent.name,
    referral_code: await ensureParentReferralCode(parent.id),
    center_id: parent.center_id,
  };
  return { ...(await issueTokenPairForParent(out)), parent: out };
}

/* ------------------------------ Con & liên kết ------------------------------ */

export async function linkStudent(
  parentId: number,
  centerId: number | null,
  studentCode?: string,
  dob?: string
): Promise<LinkedStudent> {
  const code = (studentCode || '').trim();
  if (!code) throw AppError.badRequest('Vui lòng nhập mã học viên');
  // M4: yêu cầu ngày sinh (YYYY-MM-DD) khớp với hồ sơ học viên mới cho liên kết
  if (!dob || !DATE_RE.test(dob))
    throw AppError.badRequest('Vui lòng nhập đúng ngày sinh của học viên (YYYY-MM-DD)');
  const student = (await db
    .prepare(
      'SELECT id, code, name, dob FROM students WHERE code = ?' +
        (centerId !== null ? ' AND center_id = ?' : '')
    )
    .get(...(centerId !== null ? [code, centerId] : [code]))) as
    (LinkedStudent & { dob: string | null }) | undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên với mã này');
  if (!student.dob || student.dob.slice(0, 10) !== dob) {
    throw AppError.badRequest('Ngày sinh không khớp với hồ sơ học viên');
  }
  const linked = await db
    .prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
    .get(parentId, student.id);
  if (linked) throw AppError.badRequest('Học viên này đã được liên kết');
  await db
    .prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)')
    .run(parentId, student.id);
  return student;
}

export async function listChildren(parentId: number): Promise<ChildSummary[]> {
  const children = (await db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone, s.dob, s.status, s.center_id
       FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_id = ? ORDER BY s.name`
    )
    .all(parentId)) as ChildSummary[];
  const classStmt = await db.prepare(
    `SELECT c.id, c.name FROM enrollments e JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = ? AND e.status = 'active' ORDER BY c.name`
  );
  return Promise.all(
    children.map(async (c) => ({
      ...c,
      classes: (await classStmt.all(c.id)) as { id: number; name: string }[],
    }))
  );
}

export async function getChildOverview(
  parentId: number,
  studentId: number
): Promise<Record<string, unknown>> {
  const student = await getLinkedStudent(parentId, studentId);
  const today = toISODate(new Date());

  const classes = (await db
    .prepare(
      `SELECT c.id, c.name, c.schedule, t.name as teacher_name, r.name as room_name
       FROM enrollments e JOIN classes c ON c.id = e.class_id
       LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE e.student_id = ? AND e.status = 'active' ORDER BY c.name`
    )
    .all(studentId)) as {
    id: number;
    name: string;
    schedule: string;
    teacher_name: string | null;
    room_name: string | null;
  }[];

  const upcomingSessions = await db
    .prepare(
      `SELECT s.id, s.date, s.topic, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       JOIN enrollments e ON e.class_id = c.id
       WHERE e.student_id = ? AND e.status = 'active' AND s.date >= ?
       ORDER BY s.date ASC LIMIT 10`
    )
    .all(studentId, today);

  const attRows = (await db
    .prepare('SELECT status, COUNT(*) as c FROM attendance WHERE student_id = ? GROUP BY status')
    .all(studentId)) as { status: string; c: number }[];
  const present = attRows.find((r) => r.status === 'present')?.c ?? 0;
  const absent = attRows.find((r) => r.status === 'absent')?.c ?? 0;
  const late = attRows.find((r) => r.status === 'late')?.c ?? 0;
  const total = present + absent + late;

  const invoiceRows = (await db
    .prepare(
      `SELECT i.id, i.amount, i.due_date, i.status, i.note, c.name as class_name
       FROM invoices i LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.student_id = ? ORDER BY i.id DESC`
    )
    .all(studentId)) as { id: number; amount: number }[];
  const invoices = invoiceRows.map((i) => ({ ...i, paid: confirmedPaid(i.id) }));

  const grades = await db
    .prepare(
      `SELECT g.id, g.title, g.score, g.max_score, g.comment, g.created_at, c.name as class_name
       FROM grades g LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.student_id = ? ORDER BY g.id DESC LIMIT 10`
    )
    .all(studentId);

  const homework = await db
    .prepare(
      `SELECT h.id, h.title, h.content, h.due_date, h.kind, h.max_score, h.close_date, c.name as class_name,
        CASE WHEN hc.id IS NOT NULL THEN 1 ELSE 0 END as completed,
        hs.score, hs.feedback
       FROM homework h JOIN classes c ON c.id = h.class_id
       JOIN enrollments e ON e.class_id = c.id
       LEFT JOIN homework_completions hc ON hc.homework_id = h.id AND hc.student_id = e.student_id
       LEFT JOIN homework_scores hs ON hs.homework_id = h.id AND hs.student_id = e.student_id
       WHERE e.student_id = ? AND e.status = 'active' AND h.status = 'published'
         AND ${targetScopeCond('h', 'e.student_id')}
       ORDER BY hc.id ASC, (h.due_date IS NULL), h.due_date ASC LIMIT 20`
    )
    .all(studentId);

  return {
    student,
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      schedule: formatSchedule(c.schedule),
      teacher_name: c.teacher_name,
      room_name: c.room_name,
    })),
    upcomingSessions,
    attendance: {
      present,
      absent,
      late,
      total,
      rate: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
    },
    invoices,
    grades,
    homework,
    credits: creditSummary(parentId),
  };
}

export async function listChildGrades(parentId: number, studentId: number): Promise<unknown[]> {
  await getLinkedStudent(parentId, studentId);
  return (await db
    .prepare(
      `SELECT g.id, g.title, g.score, g.max_score, g.comment, g.created_at, c.name as class_name
       FROM grades g LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.student_id = ? ORDER BY g.id DESC`
    )
    .all(studentId)) as unknown[];
}

/* -------------------------------- Thanh toán -------------------------------- */

export async function getVietqrInfo(parentId: number, invoiceId: number): Promise<Record<string, unknown>> {
  const inv = await getParentInvoice(parentId, invoiceId);
  const remaining = await remainingOrThrow(invoiceId, inv.amount);
  const cid = inv.center_id ?? 0;
  const bank = await getCenterSetting(cid, 'pay_bank_code');
  const accountNo = await getCenterSetting(cid, 'pay_bank_account_no');
  const accountName = await getCenterSetting(cid, 'pay_bank_account_name');
  if (!bank || !accountNo) throw AppError.badRequest('Trung tâm chưa cấu hình tài khoản ngân hàng');
  return {
    qr_url: `https://img.vietqr.io/image/${bank}-${accountNo}-compact2.png?amount=${remaining}&addInfo=HD${invoiceId}&accountName=${encodeURIComponent(accountName)}`,
    amount: remaining,
    addInfo: 'HD' + invoiceId,
    bank,
    account_no: accountNo,
    account_name: accountName,
  };
}

export async function claimPaid(
  parentId: number,
  invoiceId: number
): Promise<{ payment_id: number; status: string }> {
  const inv = await getParentInvoice(parentId, invoiceId);
  const remaining = await remainingOrThrow(invoiceId, inv.amount);
  const r = await db
    .prepare(
      "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'bank_transfer', ?, 'pending')"
    )
    .run(invoiceId, remaining, 'Phụ huynh báo đã chuyển khoản');
  return { payment_id: Number(r.lastInsertRowid), status: 'pending' };
}

export async function createVnpayPayment(
  parentId: number,
  invoiceId: number,
  baseUrl: string,
  ipAddr: string
): Promise<{ pay_url: string }> {
  const inv = await getParentInvoice(parentId, invoiceId);
  const remaining = await remainingOrThrow(invoiceId, inv.amount);
  const cid = inv.center_id ?? 0;
  const tmnCode = await getCenterSetting(cid, 'pay_vnp_tmncode');
  const hashSecret = await getCenterSetting(cid, 'pay_vnp_hashsecret');
  const enabled = await getCenterSetting(cid, 'pay_vnp_enabled');
  if (enabled !== '1' || !tmnCode || !hashSecret) {
    throw AppError.badRequest('Trung tâm chưa cấu hình thanh toán VNPay');
  }
  const ref = `HD${invoiceId}_${Date.now()}`;
  await db
    .prepare("INSERT INTO payment_txns (ref, invoice_id, amount, status) VALUES (?, ?, ?, 'pending')")
    .run(ref, invoiceId, remaining);
  const payUrl = buildVnpayUrl(
    { tmnCode, hashSecret, returnUrl: `${baseUrl}/api/payments/vnpay-return` },
    { amountVnd: remaining, txnRef: ref, orderInfo: 'Thanh toan hoc phi HD' + invoiceId, ipAddr }
  );
  return { pay_url: payUrl };
}

/* --------------------------------- Nghỉ phép --------------------------------- */

export async function createLeave(
  parentId: number,
  input: { student_id?: number; class_id?: number; from_date?: string; to_date?: string; reason?: string }
): Promise<{ id: number; status: string }> {
  const student = input.student_id ? await getLinkedStudent(parentId, Number(input.student_id)) : undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên');
  const { from_date, to_date } = input;
  if (!from_date || !DATE_RE.test(from_date) || !to_date || !DATE_RE.test(to_date)) {
    throw AppError.badRequest('Ngày nghỉ phải có dạng YYYY-MM-DD');
  }
  if (from_date > to_date) throw AppError.badRequest('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  // Không cho xin nghỉ cho ngày đã qua
  if (to_date < toISODate(new Date())) throw AppError.badRequest('Không thể xin nghỉ cho ngày đã qua');
  // Chặn đơn trùng: học viên đã có đơn pending/approved giao nhau với khoảng ngày này
  const overlap = (await db
    .prepare(
      `SELECT id FROM leave_requests
       WHERE student_id = ? AND status IN ('pending', 'approved')
         AND NOT (to_date < ? OR from_date > ?)`
    )
    .get(student.id, from_date, to_date)) as { id: number } | undefined;
  if (overlap) throw AppError.conflict('Học viên đã có đơn xin nghỉ trong khoảng thời gian này');
  // class_id (nếu có) phải thuộc đúng center của học viên và học viên đang học lớp đó
  let classId: number | null = null;
  if (input.class_id) {
    classId = Number(input.class_id);
    const cls = (await db.prepare('SELECT id, center_id FROM classes WHERE id = ?').get(classId)) as
      | {
          id: number;
          center_id: number | null;
        }
      | undefined;
    if (!cls || cls.center_id !== student.center_id)
      throw AppError.badRequest('Lớp học không thuộc trung tâm của học viên');
    const enrolled = await db
      .prepare("SELECT 1 FROM enrollments WHERE student_id = ? AND class_id = ? AND status = 'active'")
      .get(student.id, classId);
    if (!enrolled) throw AppError.badRequest('Học viên không đang học lớp này');
  }
  const r = await db
    .prepare(
      "INSERT INTO leave_requests (center_id, student_id, class_id, from_date, to_date, reason, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
    )
    .run(student.center_id, student.id, classId, from_date, to_date, input.reason || null);
  return { id: Number(r.lastInsertRowid), status: 'pending' };
}

export async function listLeaves(parentId: number): Promise<unknown[]> {
  return (await db
    .prepare(
      `SELECT lr.*, s.name as student_name, s.code as student_code, c.name as class_name
       FROM leave_requests lr
       JOIN parent_students ps ON ps.student_id = lr.student_id
       JOIN students s ON s.id = lr.student_id
       LEFT JOIN classes c ON c.id = lr.class_id
       WHERE ps.parent_id = ? ORDER BY lr.id DESC`
    )
    .all(parentId)) as unknown[];
}

/* ------------------------------ Giới thiệu & đánh giá ------------------------------ */

export async function getReferralInfo(parentId: number, origin: string): Promise<Record<string, unknown>> {
  const referralCode = await ensureParentReferralCode(parentId);
  // COUNT(*) FILTER trả bigint → pg-compat đổi thành number (tránh SUM numeric trả string)
  const stats = (await db
    .prepare(
      `SELECT COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'rewarded') as rewarded
       FROM referrals WHERE referrer_parent_id = ?`
    )
    .get(parentId)) as { total: number; pending: number; rewarded: number };
  const referrals = await db
    .prepare(
      'SELECT id, referred_phone, status, created_at FROM referrals WHERE referrer_parent_id = ? ORDER BY id DESC'
    )
    .all(parentId);
  return {
    referral_code: referralCode,
    share_link: `${origin}/?ref=${referralCode}`,
    stats,
    credits: creditSummary(parentId),
    referrals,
  };
}

export async function createReview(
  parentId: number,
  centerId: number | null,
  input: { rating?: number; comment?: string }
): Promise<{ id: number; status: string }> {
  const r = Number(input.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw AppError.badRequest('Đánh giá phải từ 1 đến 5 sao');
  // 1 review / parent / center: đã có thì UPDATE (unique index do data-layer migration bổ sung sau)
  const existing = (await db
    .prepare(
      'SELECT id FROM reviews WHERE parent_id = ? AND ' +
        (centerId === null ? 'center_id IS NULL' : 'center_id = ?')
    )
    .get(...(centerId === null ? [parentId] : [parentId, centerId]))) as { id: number } | undefined;
  if (existing) {
    await db
      .prepare(
        "UPDATE reviews SET rating = ?, comment = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?"
      )
      .run(r, input.comment || null, existing.id);
    return { id: existing.id, status: 'pending' };
  }
  const ins = await db
    .prepare(
      "INSERT INTO reviews (center_id, parent_id, rating, comment, status) VALUES (?, ?, ?, ?, 'pending')"
    )
    .run(centerId, parentId, r, input.comment || null);
  return { id: Number(ins.lastInsertRowid), status: 'pending' };
}

export async function listMyReviews(parentId: number): Promise<unknown[]> {
  return (await db
    .prepare('SELECT * FROM reviews WHERE parent_id = ? ORDER BY id DESC')
    .all(parentId)) as unknown[];
}

/** Phụ huynh đánh dấu con đã làm xong bài tập. */
export async function markHomeworkComplete(
  parentId: number,
  studentId: number,
  homeworkId: number
): Promise<void> {
  await getLinkedStudent(parentId, studentId);
  // Bài tập phải thuộc lớp mà con đang học và (nếu giao riêng) con phải trong danh sách
  const hw = await db
    .prepare(
      `SELECT h.id FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active' AND h.status = 'published'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId);
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  await db
    .prepare(
      `INSERT INTO homework_completions (homework_id, student_id, completed_by)
     VALUES (?, ?, 'parent')
     ON CONFLICT(homework_id, student_id) DO UPDATE SET completed_at = datetime('now'), completed_by = 'parent'`
    )
    .run(homeworkId, studentId);
}

/** Phụ huynh bỏ đánh dấu hoàn thành. */
export async function unmarkHomeworkComplete(
  parentId: number,
  studentId: number,
  homeworkId: number
): Promise<void> {
  await getLinkedStudent(parentId, studentId);
  await db
    .prepare('DELETE FROM homework_completions WHERE homework_id = ? AND student_id = ?')
    .run(homeworkId, studentId);
}

import {
  getQuizForStudent,
  submitQuiz,
  getStudentAttempts,
  getAttemptReview,
} from '../homework/quiz.service';

/* ------------------------------- Quiz cho con ------------------------------- */

async function getChildHomework(parentId: number, studentId: number, homeworkId: number) {
  await getLinkedStudent(parentId, studentId);
  const hw = (await db
    .prepare(
      `SELECT h.* FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active'
         AND h.status = 'published' AND h.kind = 'quiz'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId)) as { id: number } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài quiz');
  return hw;
}

/** Lấy đề quiz cho con (ẩn đáp án). */
export async function getQuizForChild(parentId: number, studentId: number, homeworkId: number) {
  await getChildHomework(parentId, studentId, homeworkId);
  return await getQuizForStudent(homeworkId);
}

/** Con nộp bài quiz → tự chấm. */
export async function submitChildQuiz(
  parentId: number,
  studentId: number,
  homeworkId: number,
  answers: { question_id: number; option_id: number }[]
) {
  await getChildHomework(parentId, studentId, homeworkId);
  return await submitQuiz(homeworkId, studentId, answers);
}

/** Lịch sử làm bài của con. */
export async function getChildQuizAttempts(parentId: number, studentId: number, homeworkId: number) {
  await getChildHomework(parentId, studentId, homeworkId);
  return await getStudentAttempts(homeworkId, studentId);
}

/** Xem lại chi tiết 1 lượt làm (đáp án đúng/sai). */
export async function getChildAttemptReview(parentId: number, studentId: number, attemptId: number) {
  await getLinkedStudent(parentId, studentId);
  return getAttemptReview(attemptId, studentId);
}

/* ------------------------------- Nộp bài ------------------------------- */

/** Phụ huynh nộp bài cho con (file + ghi chú). */
export async function submitHomework(
  parentId: number,
  studentId: number,
  homeworkId: number,
  data: { file_url: string | null; file_name: string | null; note: string | null }
): Promise<void> {
  await getLinkedStudent(parentId, studentId);
  const hw = (await db
    .prepare(
      `SELECT h.id, h.close_date FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active' AND h.status = 'published'
         AND h.kind = 'homework'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId)) as { id: number; close_date: string | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (hw.close_date && hw.close_date < today) throw AppError.badRequest('Đã quá hạn chót');
  if (!data.file_url && !data.note) throw AppError.badRequest('Vui lòng đính kèm file hoặc ghi chú');
  await db
    .prepare(
      `INSERT INTO homework_submissions (homework_id, student_id, file_url, file_name, note)
     VALUES (?, ?, ?, ?, ?)`
    )
    .run(homeworkId, studentId, data.file_url, data.file_name, data.note);
  await db
    .prepare(
      `INSERT INTO homework_completions (homework_id, student_id, completed_by)
     VALUES (?, ?, 'parent') ON CONFLICT(homework_id, student_id) DO NOTHING`
    )
    .run(homeworkId, studentId);
}

/** Bài đã nộp của con. */
export async function getChildSubmissions(parentId: number, studentId: number, homeworkId: number) {
  await getLinkedStudent(parentId, studentId);
  return await db
    .prepare(
      'SELECT * FROM homework_submissions WHERE homework_id = ? AND student_id = ? ORDER BY submitted_at DESC'
    )
    .all(homeworkId, studentId);
}
