/**
 * Nghiệp vụ tài khoản nhân sự: tra user đăng nhập, đổi mật khẩu, yêu cầu/xử lý đặt lại mật khẩu.
 * Route (auth.routes.ts) chỉ parse input + trả HTTP; SQL nằm ở đây (ARCH-3).
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../db';
import { invalidateTokenCheck, type AuthUser } from '../../middleware/auth';
import { AppError } from '../../shared/errors';
import { audit } from '../../shared/audit';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../../shared/password';
import { revokeAllForOwner, revokeAllForOwnerExcept } from './refresh.service';
import { assertCoversUserPerms, ROLE_RANK } from '../authorization/authorization.service';

export interface LoginUserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  name: string;
  center_id: number | null;
  teacher_id: number | null;
  token_version: number;
  is_active: boolean;
  must_change_password: boolean;
}

export async function findLoginUser(username: string): Promise<LoginUserRow | undefined> {
  return (await db.prepare('SELECT * FROM users WHERE username = ?').get(username)) as
    LoginUserRow | undefined;
}

/**
 * Đổi mật khẩu: mật khẩu cũ đúng + mới khác cũ + đủ mạnh. Tăng token_version (access token cũ chết ngay),
 * thu hồi mọi refresh token trừ phiên hiện tại (keepRefreshToken).
 */
export async function changePassword(
  u: AuthUser,
  oldPassword: string,
  newPassword: string,
  keepRefreshToken?: string
): Promise<void> {
  const row = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id)) as
    { password_hash: string } | undefined;
  if (!row || !(await bcrypt.compare(oldPassword, row.password_hash))) {
    throw AppError.badRequest('Mật khẩu cũ không đúng', 'WRONG_PASSWORD');
  }
  if (oldPassword === newPassword) {
    throw AppError.badRequest('Mật khẩu mới phải khác mật khẩu cũ', 'SAME_PASSWORD');
  }
  assertStrongPassword(newPassword, 'Mật khẩu mới');
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  // D2: tăng token_version cùng câu UPDATE → mọi access token cũ bị thu hồi ngay; N-5: hết mật khẩu tạm
  await db
    .prepare(
      'UPDATE users SET password_hash = ?, must_change_password = false, token_version = token_version + 1 WHERE id = ?'
    )
    .run(hash, u.id);
  invalidateTokenCheck('staff', u.id);
  await revokeAllForOwnerExcept('staff', u.id, keepRefreshToken);
  await audit({
    centerId: u.center_id ?? null,
    actor: { id: u.id, name: u.name, role: u.role },
    action: 'update',
    entity: 'users',
    entityId: u.id,
    summary: `${u.name} đổi mật khẩu`,
  });
}

/**
 * Ghi yêu cầu đặt lại mật khẩu. SEC-2: gắn trung tâm để admin chỉ thấy yêu cầu tenant mình.
 * staff: username duy nhất toàn hệ thống -> center của tài khoản (NULL: superadmin/không tồn tại).
 * parent: hostCenterId (theo Host); không xác định -> SĐT duy nhất toàn hệ thống mới gắn được.
 */
export async function createResetRequest(
  kind: 'staff' | 'parent',
  identifier: string,
  hostCenterId: number | null
): Promise<void> {
  let centerId: number | null = null;
  if (kind === 'staff') {
    const u = (await db.prepare('SELECT center_id FROM users WHERE username = ?').get(identifier)) as
      { center_id: number | null } | undefined;
    centerId = u?.center_id ?? null;
  } else if (hostCenterId !== null) {
    centerId = hostCenterId;
  } else {
    const ps = (await db
      .prepare('SELECT center_id FROM parents WHERE phone = ? LIMIT 2')
      .all(identifier)) as {
      center_id: number | null;
    }[];
    if (ps.length === 1) centerId = ps[0].center_id;
  }
  // J-A9: đã có yêu cầu pending cùng định danh + trung tâm -> không ghi thêm (chống spam hàng đợi admin)
  await db
    .prepare(
      `INSERT INTO reset_requests (identifier, kind, center_id)
       SELECT ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM reset_requests WHERE identifier = ? AND kind = ? AND center_id IS NOT DISTINCT FROM ?
           AND status = 'pending')`
    )
    .run(identifier, kind, centerId, identifier, kind, centerId);
}

/** Danh sách yêu cầu (chờ xử lý lên trước). cid null = superadmin thấy mọi trung tâm. */
export async function listResetRequests(cid: number | null): Promise<unknown[]> {
  return db
    .prepare(
      `SELECT id, identifier, kind, status, created_at FROM reset_requests
       ${cid !== null ? 'WHERE center_id = ?' : ''}
       ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`
    )
    .all(...(cid !== null ? [cid] : []));
}

/**
 * Xử lý yêu cầu: sinh mật khẩu tạm, đá mọi session cũ của tài khoản, đánh dấu đã xử lý.
 * Claim yêu cầu nguyên tử (UPDATE ... WHERE status='pending') cùng transaction với đổi mật khẩu —
 * 2 admin bấm cùng lúc chỉ 1 người nhận được mật khẩu tạm.
 */
export async function processResetRequest(
  cid: number | null,
  id: number,
  admin: AuthUser
): Promise<{ tempPassword: string }> {
  const r = (await db.prepare('SELECT * FROM reset_requests WHERE id = ?').get(id)) as
    { id: number; identifier: string; kind: string; status: string; center_id: number | null } | undefined;
  // Yêu cầu của trung tâm khác -> 404 như không tồn tại
  if (!r || (cid !== null && r.center_id !== cid)) throw AppError.notFound('Không tìm thấy yêu cầu');
  if (r.status !== 'pending') throw AppError.badRequest('Yêu cầu đã được xử lý', 'ALREADY_PROCESSED');

  // Tìm tài khoản theo (trung tâm của yêu cầu, định danh). Yêu cầu chưa gắn trung tâm (chỉ superadmin
  // thấy) chỉ khớp khi định danh là duy nhất — không đoán bừa giữa 2 tenant có cùng SĐT.
  const candidates = (await db
    .prepare(
      r.kind === 'staff'
        ? 'SELECT id, center_id, name, role FROM users WHERE username = ?'
        : "SELECT id, center_id, name, 'parent' AS role FROM parents WHERE phone = ?"
    )
    .all(r.identifier)) as { id: number; center_id: number | null; name: string; role: string }[];
  const target =
    r.center_id === null
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : candidates.find((c) => c.center_id === r.center_id);
  if (!target)
    throw AppError.notFound(
      `Không tìm thấy tài khoản ${r.kind === 'staff' ? 'nhân sự' : 'phụ huynh'} "${r.identifier}"`
    );

  // Không cho admin reset superadmin (trừ chính superadmin) — chống leo thang quyền.
  if (target.role === 'superadmin' && admin.role !== 'superadmin')
    throw AppError.forbidden('Chỉ superadmin được đặt lại mật khẩu của superadmin');
  // S-2: custom role được ủy quyền users.update không được chiếm tài khoản hạng cao hơn mình
  // (vai trò lạ: người xử lý hạng 0, mục tiêu hạng 3 — fail-closed).
  if ((ROLE_RANK[target.role] ?? 3) > (ROLE_RANK[admin.role] ?? 0))
    throw AppError.forbidden('Không được đặt lại mật khẩu của tài khoản có vai trò cao hơn bạn');
  // SEC-1: xuyên trung tâm CHỈ superadmin (theo role, không theo scope 'all' — scope có thể tự cấp qua custom role).
  if (admin.role !== 'superadmin' && target.center_id !== admin.center_id)
    throw AppError.forbidden('Yêu cầu thuộc trung tâm khác');
  // J-A1: cùng hạng (staff vs staff) nhưng mục tiêu giữ quyền (custom role) mà người xử lý không có
  // -> chiếm tài khoản = leo thang quyền, cùng luật với /roles/assign.
  if (r.kind === 'staff') await assertCoversUserPerms(target.id, admin);

  // Mật khẩu tạm ngẫu nhiên 12 ký tự — đủ mạnh theo assertStrongPassword (>= 8 ký tự, không phổ biến).
  const tempPassword = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  const kind = r.kind === 'staff' ? 'staff' : 'parent';
  await db.transaction(async (tx) => {
    const claimed = await tx
      .prepare("UPDATE reset_requests SET status = 'processed' WHERE id = ? AND status = 'pending'")
      .run(id);
    if (claimed.changes === 0) throw AppError.badRequest('Yêu cầu đã được xử lý', 'ALREADY_PROCESSED');
    await tx
      .prepare(
        // N-5: mật khẩu tạm -> chủ tài khoản phải đổi ngay lần đăng nhập đầu (người xử lý không dùng tiếp được)
        `UPDATE ${kind === 'staff' ? 'users' : 'parents'}
         SET password_hash = ?, must_change_password = true, token_version = token_version + 1 WHERE id = ?`
      )
      .run(hash, target.id);
  });
  invalidateTokenCheck(kind, target.id);
  await revokeAllForOwner(kind, target.id);
  await audit({
    centerId: target.center_id,
    actor: { id: admin.id, name: admin.name, role: admin.role },
    action: 'change_password',
    entity: 'reset_requests',
    entityId: id,
    summary: `${admin.name} đặt lại mật khẩu cho ${target.name} (${r.identifier})`,
  });
  return { tempPassword };
}
