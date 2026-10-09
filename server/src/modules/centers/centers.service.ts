import bcrypt from 'bcryptjs';
import { assertStrongPassword } from '../../shared/password';
import { db } from '../../db';
import { PLANS, listCenters, getCenter, type Center } from '../../utils/plans';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';

export interface CreateCenterInput {
  name: string;
  subdomain?: string | null;
  phone?: string | null;
  address?: string | null;
  plan?: string;
  plan_expires_at?: string | null;
  admin_username: string;
  admin_password: string;
}

/** Đếm số liệu cho 1 trung tâm (học viên, user, lớp). */
export async function withCounts(
  c: Center
): Promise<Center & { student_count: number; user_count: number; class_count: number }> {
  const studentCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM students WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  const userCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM users WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  const classCount = (
    (await db.prepare('SELECT COUNT(*) as c FROM classes WHERE center_id = ?').get(c.id)) as { c: number }
  ).c;
  return { ...c, student_count: studentCount, user_count: userCount, class_count: classCount };
}

export async function listCentersWithCounts(): Promise<unknown[]> {
  return Promise.all((await listCenters()).map(withCounts));
}

/**
 * Tạo trung tâm + tài khoản admin trong 1 transaction.
 * Validation nghiệp vụ ở đây (service-layer), route chỉ parse input.
 */
export async function createCenterWithAdmin(
  input: CreateCenterInput,
  actor?: AuditActor
): Promise<{ center_id: number }> {
  const name = input.name.trim();
  const adminUsername = input.admin_username.trim();
  const adminPassword = input.admin_password;
  const plan = input.plan || 'standard';
  if (!name) throw AppError.badRequest('Tên trung tâm là bắt buộc');
  if (adminUsername.length < 4) throw AppError.badRequest('Tên đăng nhập admin phải từ 4 ký tự trở lên');
  assertStrongPassword(adminPassword, 'Mật khẩu admin');
  if (!PLANS[plan]) {
    throw AppError.badRequest(`Gói cước không hợp lệ. Chọn một trong: ${Object.keys(PLANS).join(', ')}`);
  }
  const subdomain = input.subdomain?.trim().toLowerCase() || null;
  if (subdomain) {
    const dup = await db.prepare('SELECT id FROM centers WHERE subdomain = ?').get(subdomain);
    if (dup) throw AppError.badRequest('Subdomain đã được sử dụng');
  }
  const usernameTaken = await db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);
  if (usernameTaken) throw AppError.badRequest('Tên đăng nhập admin đã tồn tại');

  const centerId = await db.transaction(async (tx) => {
    const r = await tx
      .prepare(
        'INSERT INTO centers (name, subdomain, phone, address, plan, plan_expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        name,
        subdomain,
        input.phone?.trim() || null,
        input.address?.trim() || null,
        plan,
        input.plan_expires_at?.trim() || null
      );
    const centerId = Number(r.lastInsertRowid);
    const hash = bcrypt.hashSync(adminPassword, BCRYPT_ROUNDS);
    await tx
      .prepare(
        "INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, 'admin', ?, ?)"
      )
      .run(adminUsername, hash, `Quản trị ${name}`, centerId);
    return centerId;
  });
  void audit({
    centerId,
    actor,
    action: 'create',
    entity: 'centers',
    entityId: centerId,
    summary: `Tạo trung tâm "${name}" (gói ${plan})`,
    meta: { plan },
  });
  return { center_id: centerId };
}

export { getCenter };
