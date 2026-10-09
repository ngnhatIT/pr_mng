import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { AppError } from '../../shared/errors';

/* ---------------------------------- Types ---------------------------------- */

export const TRIAL_STATUS = ['new', 'contacted', 'converted'] as const;

export interface TrialRow {
  id: number;
  center_id: number | null;
  class_name?: string | null;
  [key: string]: unknown;
}

export interface TrialQuery {
  status?: string;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách đăng ký học thử (có phân trang). */
export async function listTrials(
  centerId: number | null,
  query: TrialQuery,
  pageOpts: PageOptions = {}
): Promise<Paginated<TrialRow>> {
  const { status = '' } = query;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (centerId !== null) {
    conds.push('tr.center_id = ?');
    params.push(centerId);
  }
  if (status && (TRIAL_STATUS as readonly string[]).includes(status)) {
    conds.push('tr.status = ?');
    params.push(status);
  }
  const from = `FROM trial_registrations tr LEFT JOIN classes c ON c.id = tr.class_id`;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = ((await db.prepare(`SELECT COUNT(*) as c ${from} ${where}`).get(...params)) as { c: number })
    .c;
  const rows = (await db
    .prepare(`SELECT tr.*, c.name as class_name ${from} ${where} ORDER BY tr.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as TrialRow[];
  return paginate(rows, total, page, limit);
}

interface TrialFull {
  id: number;
  center_id: number | null;
  name: string;
  phone: string;
  class_id: number | null;
  referral_code: string | null;
  status: string;
}

async function genStudentCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = `HV${Date.now().toString().slice(-6)}`;
    const exists = await db.prepare('SELECT 1 FROM students WHERE code = ?').get(code);
    if (!exists) return code;
  }
  return `HV${Date.now().toString().slice(-8)}`;
}

/**
 * Chuyển đăng ký học thử thành học viên chính thức.
 * - Khác center / không tồn tại -> 404
 * - Đã converted -> 409 (chống tạo trùng học viên khi convert 2 lần)
 */
export async function convertTrial(
  centerId: number | null,
  id: number,
  classId?: number | null
): Promise<{ student_id: number }> {
  const trial = (await db.prepare('SELECT * FROM trial_registrations WHERE id = ?').get(id)) as
    TrialFull | undefined;
  if (!trial || (centerId !== null && trial.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy đăng ký học thử');
  }
  if (trial.status === 'converted') {
    throw AppError.conflict('Đăng ký học thử này đã được chuyển đổi thành học viên');
  }
  // Guard: SĐT đã là học viên của trung tâm → không tạo trùng
  if (trial.phone && trial.center_id !== null) {
    const dup = (await db
      .prepare('SELECT id FROM students WHERE center_id = ? AND phone = ?')
      .get(trial.center_id, trial.phone)) as { id: number } | undefined;
    if (dup) {
      throw AppError.conflict('Số điện thoại này đã là học viên của trung tâm');
    }
  }
  let enrollClassId: number | null = null;
  if (classId) {
    const cls = (await db.prepare('SELECT id, center_id FROM classes WHERE id = ?').get(Number(classId))) as
      { id: number; center_id: number | null } | undefined;
    if (!cls || (centerId !== null && cls.center_id !== centerId)) {
      throw AppError.notFound('Không tìm thấy lớp học');
    }
    enrollClassId = cls.id;
  } else if (trial.class_id) {
    enrollClassId = trial.class_id;
  }

  const code = await genStudentCode();
  const studentId = await db.transaction(async (tx) => {
    const r = await tx
      .prepare("INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)")
      .run(code, trial.name, trial.phone, trial.center_id);
    const studentId = Number(r.lastInsertRowid);
    if (enrollClassId) {
      await tx
        .prepare('INSERT OR IGNORE INTO enrollments (student_id, class_id) VALUES (?, ?)')
        .run(studentId, enrollClassId);
    }
    await tx.prepare("UPDATE trial_registrations SET status = 'converted' WHERE id = ?").run(id);
    // Gắn referral đang chờ theo SĐT (nếu trial đăng ký bằng mã giới thiệu)
    if (trial.referral_code && trial.phone) {
      await tx
        .prepare(
          "UPDATE referrals SET referred_student_id = ? WHERE referred_phone = ? AND status = 'pending' AND referred_student_id IS NULL"
        )
        .run(studentId, trial.phone);
    }
    return studentId;
  });
  return { student_id: studentId };
}
