import { db } from '../../db';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { nextStudentCode } from '../students/students.service';
import { enrollInTx } from '../classes/classes.service';

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
  if (status && !(TRIAL_STATUS as readonly string[]).includes(status)) {
    // Filter sai không được âm thầm bỏ qua (trả TẤT CẢ dưới nhãn của trạng thái khác)
    throw AppError.badRequest('Trạng thái lọc không hợp lệ');
  }
  if (status) {
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
    // Lớp phải cùng trung tâm với đăng ký học thử (kể cả khi superadmin thao tác)
    if (!cls || cls.center_id !== trial.center_id) {
      throw AppError.notFound('Không tìm thấy lớp học');
    }
    enrollClassId = cls.id;
  } else if (trial.class_id) {
    enrollClassId = trial.class_id;
  }

  const trialCenterId = trial.center_id;
  if (trialCenterId === null) throw AppError.badRequest('Đăng ký học thử chưa gắn trung tâm');
  const studentId = await db.transaction(async (tx) => {
    // Atomic: chỉ 1 luồng giành được chuyển trạng thái (chống convert đồng thời tạo trùng học viên)
    const upd = await tx
      .prepare("UPDATE trial_registrations SET status = 'converted' WHERE id = ? AND status != 'converted'")
      .run(id);
    if ((upd.changes ?? 0) !== 1) {
      throw AppError.conflict('Đăng ký học thử này đã được chuyển đổi thành học viên');
    }
    const code = await nextStudentCode(tx, trialCenterId);
    const r = await tx
      .prepare("INSERT INTO students (code, name, phone, status, center_id) VALUES (?, ?, ?, 'studying', ?)")
      .run(code, trial.name, trial.phone, trialCenterId);
    const studentId = Number(r.lastInsertRowid);
    // Ghi danh qua cùng logic có lock + kiểm tra sĩ số/lớp ngừng hoạt động như ghi danh thủ công
    if (enrollClassId) await enrollInTx(tx, enrollClassId, studentId);
    // Gắn ĐÚNG referral của mã giới thiệu trên trial, trong cùng trung tâm (không gắn mọi referral theo SĐT)
    if (trial.referral_code && trial.phone) {
      await tx
        .prepare(
          `UPDATE referrals SET referred_student_id = ?
           WHERE id = (
             SELECT r.id FROM referrals r JOIN parents p ON p.id = r.referrer_parent_id
             WHERE p.referral_code = ? AND p.center_id = ? AND COALESCE(r.center_id, p.center_id) = ?
               AND r.referred_phone = ? AND r.status = 'pending' AND r.referred_student_id IS NULL
             ORDER BY r.id LIMIT 1
           )`
        )
        .run(studentId, trial.referral_code, trialCenterId, trialCenterId, trial.phone);
    }
    return studentId;
  });
  return { student_id: studentId };
}

/** Đổi trạng thái đăng ký học thử (không cho 'converted' — phải qua convertTrial). */
export async function updateTrialStatus(
  centerId: number | null,
  id: number,
  status: string,
  actor: AuditActor
) {
  const trial = (await db
    .prepare('SELECT id, center_id, name, status FROM trial_registrations WHERE id = ?')
    .get(id)) as { id: number; center_id: number | null; name: string; status: string } | undefined;
  if (!trial || (centerId !== null && trial.center_id !== centerId)) {
    throw AppError.notFound('Không tìm thấy đăng ký học thử');
  }
  // Đã chuyển thành học viên thì khóa trạng thái (mở lại rồi convert lần nữa = học viên trùng).
  // Điều kiện status != 'converted' ngay trong UPDATE để chống race với convert đồng thời.
  const upd = await db
    .prepare("UPDATE trial_registrations SET status = ? WHERE id = ? AND status <> 'converted'")
    .run(status, id);
  if ((upd.changes ?? 0) !== 1) {
    throw AppError.conflict('Đăng ký học thử đã chuyển thành học viên, không thể đổi trạng thái');
  }
  await audit({
    centerId: trial.center_id,
    actor,
    action: 'update',
    entity: 'trial_registrations',
    entityId: id,
    summary: `Đổi trạng thái học thử ${trial.name}: ${trial.status} → ${status}`,
    meta: { old_status: trial.status, new_status: status },
  });
  return db.prepare('SELECT * FROM trial_registrations WHERE id = ?').get(id);
}
