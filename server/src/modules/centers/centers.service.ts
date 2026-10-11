import bcrypt from 'bcryptjs';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../../shared/password';
import { db } from '../../db';
import { PLANS, listCenters, getCenter, type Center } from '../../utils/plans';
import { AppError } from '../../shared/errors';
import { validate, v } from '../../shared/validate';
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

  // Hash ngoài transaction và async: không giữ connection/chặn event loop trong lúc bcrypt chạy
  const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
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
    await tx
      .prepare(
        // N-5: superadmin đặt mật khẩu hộ -> admin trung tâm phải đổi ở lần đăng nhập đầu
        `INSERT INTO users (username, password_hash, role, name, center_id, must_change_password)
         VALUES (?, ?, 'admin', ?, ?, true)`
      )
      .run(adminUsername, hash, `Quản trị ${name}`, centerId);
    return centerId;
  });
  await audit({
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

/** Cập nhật trung tâm (chỉ superadmin — route kiểm). Chỉ đổi các trường có trong body. */
export async function updateCenter(id: number, body: Record<string, unknown>): Promise<void> {
  if (!(await getCenter(id))) throw AppError.notFound('Không tìm thấy trung tâm');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw AppError.badRequest('Tên trung tâm không được để trống');
    sets.push('name = ?');
    params.push(name);
  }
  if (body.phone !== undefined) {
    sets.push('phone = ?');
    params.push(body.phone ? String(body.phone).trim() : null);
  }
  if (body.address !== undefined) {
    sets.push('address = ?');
    params.push(body.address ? String(body.address).trim() : null);
  }
  if (body.plan !== undefined) {
    const plan = String(body.plan);
    if (!PLANS[plan]) {
      throw AppError.badRequest(`Gói cước không hợp lệ. Chọn một trong: ${Object.keys(PLANS).join(', ')}`);
    }
    sets.push('plan = ?');
    params.push(plan);
  }
  if (body.plan_expires_at !== undefined) {
    const expRaw = body.plan_expires_at ? String(body.plan_expires_at).trim() : null;
    if (expRaw) validate({ d: expRaw }, { d: v.date({ label: 'Hạn gói' }) }); // validate ngày thật
    sets.push('plan_expires_at = ?');
    params.push(expRaw);
  }
  if (sets.length > 0)
    await db.prepare(`UPDATE centers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

export { getCenter };
