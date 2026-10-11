import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { invalidateTokenCheck } from '../../middleware/auth';
import { revokeAllForOwner } from '../auth/refresh.service';
import { audit, type AuditActor } from '../../shared/audit';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../../shared/password';
import { AppError } from '../../shared/errors';
import { parsePagination, paginate, type PageOptions, type Paginated } from '../../shared/pagination';

/* ---------------------------------- Types ---------------------------------- */

export interface TeacherRow {
  id: number;
  name: string;
  center_id: number | null;
  class_count?: number;
  [key: string]: unknown;
}

/* --------------------------------- Service --------------------------------- */

/** Danh sách giáo viên kèm số lớp đang dạy (có phân trang). */
export async function listTeachers(
  centerId: number | null,
  pageOpts: PageOptions = {}
): Promise<Paginated<TeacherRow>> {
  const where = centerId !== null ? 'WHERE t.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [centerId] : [];
  const { page, limit, offset } = parsePagination(pageOpts);
  const total = (
    (await db.prepare(`SELECT COUNT(*) as c FROM teachers t ${where}`).get(...params)) as { c: number }
  ).c;
  const rows = (await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM classes WHERE teacher_id = t.id AND status = 'active') as class_count
       FROM teachers t ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as TeacherRow[];
  return paginate(rows, total, page, limit);
}

/** Chi tiết giáo viên kèm số lớp đang dạy; 404 khi không tồn tại hoặc khác center. */
export async function getTeacherDetail(centerId: number | null, id: number): Promise<TeacherRow> {
  const where = centerId !== null ? 'AND t.center_id = ?' : '';
  const params: unknown[] = centerId !== null ? [id, centerId] : [id];
  const row = (await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM classes WHERE teacher_id = t.id AND status = 'active') as class_count
       FROM teachers t WHERE t.id = ? ${where}`
    )
    .get(...params)) as TeacherRow | undefined;
  if (!row) throw AppError.notFound('Không tìm thấy giáo viên');
  return row;
}

export interface TeacherInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  subject?: string | null;
}

async function getScopedTeacher(centerId: number | null, id: number) {
  const t = (await db.prepare('SELECT * FROM teachers WHERE id = ?').get(id)) as TeacherRow | undefined;
  if (!t || (centerId !== null && t.center_id !== centerId))
    throw AppError.notFound('Không tìm thấy giáo viên');
  return t;
}

export async function createTeacher(centerId: number, d: TeacherInput) {
  const r = await db
    .prepare('INSERT INTO teachers (name, phone, email, subject, center_id) VALUES (?, ?, ?, ?, ?)')
    .run(d.name.trim(), d.phone || null, d.email || null, d.subject || null, centerId);
  return db.prepare('SELECT * FROM teachers WHERE id = ?').get(Number(r.lastInsertRowid));
}

export async function updateTeacher(centerId: number | null, id: number, d: TeacherInput) {
  await getScopedTeacher(centerId, id);
  const r = await db
    .prepare('UPDATE teachers SET name=?, phone=?, email=?, subject=? WHERE id=?')
    .run(d.name.trim(), d.phone || null, d.email || null, d.subject || null, id);
  if (r.changes === 0) throw AppError.notFound('Không tìm thấy giáo viên');
  return db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
}

/** Xóa giáo viên chưa có lịch sử lương/dạy; khóa tài khoản đăng nhập + thu hồi phiên. */
export async function deleteTeacher(centerId: number | null, id: number, actor: AuditActor): Promise<void> {
  const cur = await getScopedTeacher(centerId, id);
  // Chặn xóa giáo viên đã có lịch sử lương (mất cấu hình tính lương, không đối chiếu được)
  const payrollRow = (await db
    .prepare('SELECT COUNT(*) as c FROM salary_rules WHERE teacher_id = ?')
    .get(id)) as { c: string } | undefined;
  if (payrollRow && (Number(payrollRow.c) || 0) > 0) {
    throw AppError.badRequest(
      'Không thể xóa: giáo viên đã có lịch sử lương. Vô hiệu hóa thay vì xóa.',
      'HAS_PAYROLL'
    );
  }
  // Chặn xóa giáo viên đã có check-in hoặc buổi dạy đã điểm danh (mất lịch sử lương)
  const taught = await db
    .prepare(
      `SELECT 1 FROM teacher_checkins WHERE teacher_id = ?
       UNION ALL
       SELECT 1 FROM sessions s WHERE s.teacher_id = ? AND EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)
       LIMIT 1`
    )
    .get(id, id);
  if (taught) {
    throw AppError.badRequest(
      'Không thể xóa: giáo viên đã có lịch sử dạy (check-in/điểm danh). Vô hiệu hóa thay vì xóa.',
      'HAS_PAYROLL'
    );
  }
  const disabled = await db.transaction(async (tx) => {
    // Khóa tài khoản đăng nhập của giáo viên (cựu GV không còn đăng nhập được) + tăng token_version
    const users = (await tx
      .prepare(
        'UPDATE users SET is_active = FALSE, token_version = token_version + 1 WHERE teacher_id = ? RETURNING id'
      )
      .all(id)) as { id: number }[];
    await tx.prepare('UPDATE classes SET teacher_id = NULL WHERE teacher_id = ?').run(id);
    await tx.prepare('DELETE FROM teacher_checkins WHERE teacher_id = ?').run(id);
    await tx.prepare('DELETE FROM salary_rules WHERE teacher_id = ?').run(id);
    await tx.prepare('DELETE FROM teachers WHERE id = ?').run(id);
    return users;
  });
  for (const u of disabled) {
    invalidateTokenCheck('staff', u.id);
    await revokeAllForOwner('staff', u.id);
  }
  await audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'teachers',
    entityId: id,
    summary: `Xóa giáo viên ${cur.name || `#${id}`}`,
  });
}

/** Cấp tài khoản đăng nhập (role teacher) cho giáo viên. */
export async function createTeacherAccount(
  centerId: number | null,
  id: number,
  username: string,
  password: string,
  actor: AuditActor
): Promise<{ ok: true; username: string; user_id: number }> {
  const teacher = await getScopedTeacher(centerId, id);
  // Hồ sơ cũ chưa gán trung tâm -> không cấp tài khoản (user center NULL bị DB CHECK chặn, và sẽ fail-closed)
  if (teacher.center_id == null)
    throw AppError.badRequest('Giáo viên chưa thuộc trung tâm nào', 'CENTER_REQUIRED');
  try {
    assertStrongPassword(password);
  } catch (err) {
    throw AppError.badRequest((err as { message?: string }).message || 'Mật khẩu quá yếu', 'WEAK_PASSWORD');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw AppError.badRequest('Tên đăng nhập đã tồn tại', 'ALREADY_EXISTS');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE teacher_id = ?').get(id)) {
    throw AppError.badRequest('Giáo viên này đã có tài khoản đăng nhập');
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const r = await db
    .prepare(
      // N-5: admin đặt mật khẩu hộ -> giáo viên phải đổi ở lần đăng nhập đầu
      `INSERT INTO users (username, password_hash, role, name, center_id, teacher_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, true)`
    )
    .run(username, hash, 'teacher', teacher.name, teacher.center_id, id);
  const userId = Number(r.lastInsertRowid);
  await audit({
    centerId: teacher.center_id,
    actor,
    action: 'create',
    entity: 'users',
    entityId: userId,
    summary: `Cấp tài khoản đăng nhập cho giáo viên ${teacher.name}`,
    meta: { username, teacher_id: id },
  });
  return { ok: true, username, user_id: userId };
}
