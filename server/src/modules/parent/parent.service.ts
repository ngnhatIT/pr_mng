import bcrypt from 'bcryptjs';
import { db, toISODate, confirmedPaid, getCenterSetting, formatSchedule } from '../../db';
import { signToken, AuthUser } from '../../middleware/auth';
import { ensureParentReferralCode } from '../../services/referrals';
import { buildVnpayUrl } from '../../services/vnpay';
import { normalizePhone } from '../../services/zalo';
import { getDefaultCenter } from '../../utils/plans';
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

function issueToken(p: ParentPublic): string {
  const payload: AuthUser = {
    id: p.id,
    username: p.phone,
    role: 'parent',
    name: p.name,
    center_id: p.center_id,
    parent_id: p.id,
  };
  return signToken(payload);
}

/** Học viên phải thuộc parent (chống xem trộm con người khác). */
export function getLinkedStudent(parentId: number, studentId: number): LinkedStudent {
  const student = db
    .prepare(
      `SELECT s.* FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_id = ? AND s.id = ?`
    )
    .get(parentId, studentId) as LinkedStudent | undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên');
  return student;
}

/** Hóa đơn phải thuộc con của parent. */
function getParentInvoice(
  parentId: number,
  invoiceId: number
): { id: number; amount: number; status: string; center_id: number | null } {
  const inv = db
    .prepare(
      `SELECT i.*, s.center_id
       FROM invoices i
       JOIN parent_students ps ON ps.student_id = i.student_id
       JOIN students s ON s.id = i.student_id
       WHERE i.id = ? AND ps.parent_id = ?`
    )
    .get(invoiceId, parentId) as
    { id: number; amount: number; status: string; center_id: number | null } | undefined;
  if (!inv) throw AppError.notFound('Không tìm thấy hóa đơn');
  return inv;
}

/** Số tiền còn nợ của hóa đơn — ném 400 nếu đã thanh toán đủ. */
function remainingOrThrow(invoiceId: number, amount: number): number {
  const remaining = Math.round(amount - confirmedPaid(invoiceId));
  if (remaining <= 0) throw AppError.badRequest('Hóa đơn đã thanh toán đủ');
  return remaining;
}

function creditSummary(parentId: number): { total: number; used: number; available: number } {
  const cr = db
    .prepare(
      'SELECT COALESCE(SUM(amount),0) as total, COALESCE(SUM(used_amount),0) as used FROM credits WHERE parent_id = ?'
    )
    .get(parentId) as { total: number; used: number };
  return { total: cr.total, used: cr.used, available: cr.total - cr.used };
}

/* ------------------------------- Auth phụ huynh ------------------------------- */

export function registerParent(input: { phone?: string; password?: string; name?: string }): {
  token: string;
  parent: ParentPublic;
} {
  const normalized = normalizePhone(input.phone);
  if (!normalized) throw AppError.badRequest('Số điện thoại không hợp lệ');
  if (!input.password || input.password.length < 4)
    throw AppError.badRequest('Mật khẩu phải có ít nhất 4 ký tự');
  const name = (input.name || '').trim();
  if (!name) throw AppError.badRequest('Vui lòng nhập họ tên');

  const center = getDefaultCenter();
  if (!center) throw AppError.badRequest('Chưa có trung tâm nào trong hệ thống');

  const exists = db
    .prepare('SELECT id FROM parents WHERE center_id = ? AND phone = ?')
    .get(center.id, normalized);
  if (exists) throw AppError.conflict('Số điện thoại này đã được đăng ký');

  const hash = bcrypt.hashSync(input.password, 10);
  const r = db
    .prepare('INSERT INTO parents (center_id, phone, password_hash, name) VALUES (?, ?, ?, ?)')
    .run(center.id, normalized, hash, name);
  const parentId = Number(r.lastInsertRowid);
  const parent: ParentPublic = {
    id: parentId,
    phone: normalized,
    name,
    referral_code: ensureParentReferralCode(parentId),
    center_id: center.id,
  };
  return { token: issueToken(parent), parent };
}

export function loginParent(input: { phone?: string; password?: string }): {
  token: string;
  parent: ParentPublic;
} {
  const normalized = normalizePhone(input.phone);
  if (!normalized || !input.password) throw AppError.badRequest('Vui lòng nhập số điện thoại và mật khẩu');

  const center = getDefaultCenter();
  const parent = db
    .prepare('SELECT * FROM parents WHERE phone = ?' + (center ? ' AND center_id = ?' : ''))
    .get(center ? [normalized, center.id] : [normalized]) as ParentRow | undefined;
  if (!parent || !bcrypt.compareSync(input.password, parent.password_hash)) {
    throw AppError.unauthorized('Số điện thoại hoặc mật khẩu không đúng');
  }
  const out: ParentPublic = {
    id: parent.id,
    phone: parent.phone,
    name: parent.name,
    referral_code: ensureParentReferralCode(parent.id),
    center_id: parent.center_id,
  };
  return { token: issueToken(out), parent: out };
}

/* ------------------------------ Con & liên kết ------------------------------ */

export function linkStudent(parentId: number, centerId: number | null, studentCode?: string): LinkedStudent {
  const code = (studentCode || '').trim();
  if (!code) throw AppError.badRequest('Vui lòng nhập mã học viên');
  const student = db
    .prepare(
      'SELECT id, code, name FROM students WHERE code = ?' + (centerId !== null ? ' AND center_id = ?' : '')
    )
    .get(centerId !== null ? [code, centerId] : [code]) as LinkedStudent | undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên với mã này');
  const linked = db
    .prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
    .get(parentId, student.id);
  if (linked) throw AppError.badRequest('Học viên này đã được liên kết');
  db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parentId, student.id);
  return student;
}

export function listChildren(parentId: number): ChildSummary[] {
  const children = db
    .prepare(
      `SELECT s.id, s.code, s.name, s.phone, s.dob, s.status, s.center_id
       FROM parent_students ps JOIN students s ON s.id = ps.student_id
       WHERE ps.parent_id = ? ORDER BY s.name`
    )
    .all(parentId) as ChildSummary[];
  const classStmt = db.prepare(
    `SELECT c.id, c.name FROM enrollments e JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = ? AND e.status = 'active' ORDER BY c.name`
  );
  return children.map((c) => ({ ...c, classes: classStmt.all(c.id) as { id: number; name: string }[] }));
}

export function getChildOverview(parentId: number, studentId: number): Record<string, unknown> {
  const student = getLinkedStudent(parentId, studentId);
  const today = toISODate(new Date());

  const classes = db
    .prepare(
      `SELECT c.id, c.name, c.schedule, t.name as teacher_name, r.name as room_name
       FROM enrollments e JOIN classes c ON c.id = e.class_id
       LEFT JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE e.student_id = ? AND e.status = 'active' ORDER BY c.name`
    )
    .all(studentId) as {
    id: number;
    name: string;
    schedule: string;
    teacher_name: string | null;
    room_name: string | null;
  }[];

  const upcomingSessions = db
    .prepare(
      `SELECT s.id, s.date, s.topic, c.name as class_name
       FROM sessions s JOIN classes c ON c.id = s.class_id
       JOIN enrollments e ON e.class_id = c.id
       WHERE e.student_id = ? AND e.status = 'active' AND s.date >= ?
       ORDER BY s.date ASC LIMIT 10`
    )
    .all(studentId, today);

  const attRows = db
    .prepare('SELECT status, COUNT(*) as c FROM attendance WHERE student_id = ? GROUP BY status')
    .all(studentId) as { status: string; c: number }[];
  const present = attRows.find((r) => r.status === 'present')?.c ?? 0;
  const absent = attRows.find((r) => r.status === 'absent')?.c ?? 0;
  const late = attRows.find((r) => r.status === 'late')?.c ?? 0;
  const total = present + absent + late;

  const invoiceRows = db
    .prepare(
      `SELECT i.id, i.amount, i.due_date, i.status, i.note, c.name as class_name
       FROM invoices i LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.student_id = ? ORDER BY i.id DESC`
    )
    .all(studentId) as { id: number; amount: number }[];
  const invoices = invoiceRows.map((i) => ({ ...i, paid: confirmedPaid(i.id) }));

  const grades = db
    .prepare(
      `SELECT g.id, g.title, g.score, g.max_score, g.comment, g.created_at, c.name as class_name
       FROM grades g LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.student_id = ? ORDER BY g.id DESC LIMIT 10`
    )
    .all(studentId);

  const homework = db
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

export function listChildGrades(parentId: number, studentId: number): unknown[] {
  getLinkedStudent(parentId, studentId);
  return db
    .prepare(
      `SELECT g.id, g.title, g.score, g.max_score, g.comment, g.created_at, c.name as class_name
       FROM grades g LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.student_id = ? ORDER BY g.id DESC`
    )
    .all(studentId) as unknown[];
}

/* -------------------------------- Thanh toán -------------------------------- */

export function getVietqrInfo(parentId: number, invoiceId: number): Record<string, unknown> {
  const inv = getParentInvoice(parentId, invoiceId);
  const remaining = remainingOrThrow(invoiceId, inv.amount);
  const cid = inv.center_id ?? 0;
  const bank = getCenterSetting(cid, 'pay_bank_code');
  const accountNo = getCenterSetting(cid, 'pay_bank_account_no');
  const accountName = getCenterSetting(cid, 'pay_bank_account_name');
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

export function claimPaid(parentId: number, invoiceId: number): { payment_id: number; status: string } {
  const inv = getParentInvoice(parentId, invoiceId);
  const remaining = remainingOrThrow(invoiceId, inv.amount);
  const r = db
    .prepare(
      "INSERT INTO payments (invoice_id, amount, method, note, status) VALUES (?, ?, 'bank_transfer', ?, 'pending')"
    )
    .run(invoiceId, remaining, 'Phụ huynh báo đã chuyển khoản');
  return { payment_id: Number(r.lastInsertRowid), status: 'pending' };
}

export function createVnpayPayment(
  parentId: number,
  invoiceId: number,
  baseUrl: string,
  ipAddr: string
): { pay_url: string } {
  const inv = getParentInvoice(parentId, invoiceId);
  const remaining = remainingOrThrow(invoiceId, inv.amount);
  const cid = inv.center_id ?? 0;
  const tmnCode = getCenterSetting(cid, 'pay_vnp_tmncode');
  const hashSecret = getCenterSetting(cid, 'pay_vnp_hashsecret');
  const enabled = getCenterSetting(cid, 'pay_vnp_enabled');
  if (enabled !== '1' || !tmnCode || !hashSecret) {
    throw AppError.badRequest('Trung tâm chưa cấu hình thanh toán VNPay');
  }
  const ref = `HD${invoiceId}_${Date.now()}`;
  db.prepare("INSERT INTO payment_txns (ref, invoice_id, amount, status) VALUES (?, ?, ?, 'pending')").run(
    ref,
    invoiceId,
    remaining
  );
  const payUrl = buildVnpayUrl(
    { tmnCode, hashSecret, returnUrl: `${baseUrl}/api/payments/vnpay-return` },
    { amountVnd: remaining, txnRef: ref, orderInfo: 'Thanh toan hoc phi HD' + invoiceId, ipAddr }
  );
  return { pay_url: payUrl };
}

/* --------------------------------- Nghỉ phép --------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createLeave(
  parentId: number,
  input: { student_id?: number; class_id?: number; from_date?: string; to_date?: string; reason?: string }
): { id: number; status: string } {
  const student = input.student_id ? getLinkedStudent(parentId, Number(input.student_id)) : undefined;
  if (!student) throw AppError.notFound('Không tìm thấy học viên');
  const { from_date, to_date } = input;
  if (!from_date || !DATE_RE.test(from_date) || !to_date || !DATE_RE.test(to_date)) {
    throw AppError.badRequest('Ngày nghỉ phải có dạng YYYY-MM-DD');
  }
  if (from_date > to_date) throw AppError.badRequest('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  const r = db
    .prepare(
      "INSERT INTO leave_requests (center_id, student_id, class_id, from_date, to_date, reason, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
    )
    .run(
      student.center_id,
      student.id,
      input.class_id ? Number(input.class_id) : null,
      from_date,
      to_date,
      input.reason || null
    );
  return { id: Number(r.lastInsertRowid), status: 'pending' };
}

export function listLeaves(parentId: number): unknown[] {
  return db
    .prepare(
      `SELECT lr.*, s.name as student_name, s.code as student_code, c.name as class_name
       FROM leave_requests lr
       JOIN parent_students ps ON ps.student_id = lr.student_id
       JOIN students s ON s.id = lr.student_id
       LEFT JOIN classes c ON c.id = lr.class_id
       WHERE ps.parent_id = ? ORDER BY lr.id DESC`
    )
    .all(parentId) as unknown[];
}

/* ------------------------------ Giới thiệu & đánh giá ------------------------------ */

export function getReferralInfo(parentId: number, origin: string): Record<string, unknown> {
  const referralCode = ensureParentReferralCode(parentId);
  const stats = db
    .prepare(
      `SELECT COUNT(*) as total,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
         COALESCE(SUM(CASE WHEN status = 'rewarded' THEN 1 ELSE 0 END), 0) as rewarded
       FROM referrals WHERE referrer_parent_id = ?`
    )
    .get(parentId) as { total: number; pending: number; rewarded: number };
  const referrals = db
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

export function createReview(
  parentId: number,
  centerId: number | null,
  input: { rating?: number; comment?: string }
): { id: number; status: string } {
  const r = Number(input.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw AppError.badRequest('Đánh giá phải từ 1 đến 5 sao');
  const ins = db
    .prepare(
      "INSERT INTO reviews (center_id, parent_id, rating, comment, status) VALUES (?, ?, ?, ?, 'pending')"
    )
    .run(centerId, parentId, r, input.comment || null);
  return { id: Number(ins.lastInsertRowid), status: 'pending' };
}

export function listMyReviews(parentId: number): unknown[] {
  return db.prepare('SELECT * FROM reviews WHERE parent_id = ? ORDER BY id DESC').all(parentId) as unknown[];
}

/** Phụ huynh đánh dấu con đã làm xong bài tập. */
export function markHomeworkComplete(parentId: number, studentId: number, homeworkId: number): void {
  getLinkedStudent(parentId, studentId);
  // Bài tập phải thuộc lớp mà con đang học và (nếu giao riêng) con phải trong danh sách
  const hw = db
    .prepare(
      `SELECT h.id FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active' AND h.status = 'published'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId);
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  db.prepare(
    `INSERT INTO homework_completions (homework_id, student_id, completed_by)
     VALUES (?, ?, 'parent')
     ON CONFLICT(homework_id, student_id) DO UPDATE SET completed_at = datetime('now'), completed_by = 'parent'`
  ).run(homeworkId, studentId);
}

/** Phụ huynh bỏ đánh dấu hoàn thành. */
export function unmarkHomeworkComplete(parentId: number, studentId: number, homeworkId: number): void {
  getLinkedStudent(parentId, studentId);
  db.prepare('DELETE FROM homework_completions WHERE homework_id = ? AND student_id = ?').run(
    homeworkId,
    studentId
  );
}

import { getQuizForStudent, submitQuiz, getStudentAttempts, getAttemptReview } from '../homework/quiz.service';

/* ------------------------------- Quiz cho con ------------------------------- */

function getChildHomework(parentId: number, studentId: number, homeworkId: number) {
  getLinkedStudent(parentId, studentId);
  const hw = db
    .prepare(
      `SELECT h.* FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active'
         AND h.status = 'published' AND h.kind = 'quiz'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId) as { id: number } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài quiz');
  return hw;
}

/** Lấy đề quiz cho con (ẩn đáp án). */
export function getQuizForChild(parentId: number, studentId: number, homeworkId: number) {
  getChildHomework(parentId, studentId, homeworkId);
  return getQuizForStudent(homeworkId);
}

/** Con nộp bài quiz → tự chấm. */
export function submitChildQuiz(
  parentId: number,
  studentId: number,
  homeworkId: number,
  answers: { question_id: number; option_id: number }[]
) {
  getChildHomework(parentId, studentId, homeworkId);
  return submitQuiz(homeworkId, studentId, answers);
}

/** Lịch sử làm bài của con. */
export function getChildQuizAttempts(parentId: number, studentId: number, homeworkId: number) {
  getChildHomework(parentId, studentId, homeworkId);
  return getStudentAttempts(homeworkId, studentId);
}

/** Xem lại chi tiết 1 lượt làm (đáp án đúng/sai). */
export function getChildAttemptReview(parentId: number, studentId: number, attemptId: number) {
  getLinkedStudent(parentId, studentId);
  return getAttemptReview(attemptId, studentId);
}

/* ------------------------------- Nộp bài ------------------------------- */

/** Phụ huynh nộp bài cho con (file + ghi chú). */
export function submitHomework(
  parentId: number,
  studentId: number,
  homeworkId: number,
  data: { file_url: string | null; file_name: string | null; note: string | null }
): void {
  getLinkedStudent(parentId, studentId);
  const hw = db
    .prepare(
      `SELECT h.id, h.close_date FROM homework h
       JOIN enrollments e ON e.class_id = h.class_id
       WHERE h.id = ? AND e.student_id = ? AND e.status = 'active' AND h.status = 'published'
         AND h.kind = 'homework'
         AND ${targetScopeCond('h', '?')}`
    )
    .get(homeworkId, studentId, studentId) as { id: number; close_date: string | null } | undefined;
  if (!hw) throw AppError.notFound('Không tìm thấy bài tập');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (hw.close_date && hw.close_date < today) throw AppError.badRequest('Đã quá hạn chót');
  if (!data.file_url && !data.note) throw AppError.badRequest('Vui lòng đính kèm file hoặc ghi chú');
  db.prepare(
    `INSERT INTO homework_submissions (homework_id, student_id, file_url, file_name, note)
     VALUES (?, ?, ?, ?, ?)`
  ).run(homeworkId, studentId, data.file_url, data.file_name, data.note);
  db.prepare(
    `INSERT INTO homework_completions (homework_id, student_id, completed_by)
     VALUES (?, ?, 'parent') ON CONFLICT(homework_id, student_id) DO NOTHING`
  ).run(homeworkId, studentId);
}

/** Bài đã nộp của con. */
export function getChildSubmissions(parentId: number, studentId: number, homeworkId: number) {
  getLinkedStudent(parentId, studentId);
  return db
    .prepare('SELECT * FROM homework_submissions WHERE homework_id = ? AND student_id = ? ORDER BY submitted_at DESC')
    .all(homeworkId, studentId);
}
