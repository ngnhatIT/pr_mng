/**
 * Authorization core service — kiểm tra quyền hạn của user.
 *
 * Quyền của user = hợp của:
 *  1. Permissions từ role chính (users.role -> roles.code)
 *  2. Permissions từ các custom roles (user_roles)
 *
 * Mỗi permission gắn với scope: 'own' | 'center' | 'all'
 * - 'own': chỉ dữ liệu của chính mình (vd: giáo viên chỉ lớp mình dạy)
 * - 'center': dữ liệu trong trung tâm của mình
 * - 'all': toàn hệ thống (superadmin)
 *
 * Scope mạnh nhất thắng: all > center > own.
 */
import { db } from '../../db/pg-compat';
import type { AuthUser } from '../../middleware/auth';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { PERMISSIONS, SYSTEM_ROLES } from './permissions';

export type Scope = 'own' | 'center' | 'all';

const SCOPE_RANK: Record<Scope, number> = { own: 1, center: 2, all: 3 };

export interface UserPermission {
  code: string;
  scope: Scope;
}

/** Cache permissions theo userId — TTL 60s để đổi role có hiệu lực nhanh mà không query mỗi request. */
const cache = new Map<number, { at: number; perms: Map<string, Scope> }>();
const CACHE_TTL_MS = 60_000;

export function invalidateUserPermissions(userId: number): void {
  cache.delete(userId);
}

export function invalidateAllPermissions(): void {
  cache.clear();
}

/** Lấy tất cả permissions (kèm scope mạnh nhất) của user. */
export async function getUserPermissions(userId: number): Promise<Map<string, Scope>> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.perms;

  // Role chính từ users.role + custom roles từ user_roles
  const userRow = (await db.prepare('SELECT role, center_id FROM users WHERE id = ?').get(userId)) as
    | {
        role: string;
        center_id: number | null;
      }
    | undefined;
  if (!userRow) return new Map();

  // Role chính: CHỈ role hệ thống (center_id IS NULL) — custom role của trung tâm nào đó trùng code
  // 'admin' không được lẫn vào. Custom roles lấy theo role_id (code không còn unique toàn cục).
  const rows = (await db
    .prepare(
      `SELECT p.code, rp.scope FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id IN (
         SELECT id FROM roles WHERE code = ? AND center_id IS NULL
         UNION SELECT role_id FROM user_roles WHERE user_id = ?
       )`
    )
    .all(userRow.role, userId)) as { code: string; scope: Scope }[];

  const perms = new Map<string, Scope>();
  for (const row of rows) {
    // Scope 'all' (xuyên tenant) chỉ dành cho superadmin — user thường bị hạ về 'center'
    // dù role nào đó lỡ chứa 'all' (chống SEC-1: admin tự cấp scope all qua custom role).
    const scope: Scope = row.scope === 'all' && userRow.role !== 'superadmin' ? 'center' : row.scope;
    const cur = perms.get(row.code);
    if (!cur || SCOPE_RANK[scope] > SCOPE_RANK[cur]) perms.set(row.code, scope);
  }

  cache.set(userId, { at: Date.now(), perms });
  return perms;
}

/** User có permission này không? Trả về scope nếu có, null nếu không. */
export async function getPermissionScope(userId: number, permissionCode: string): Promise<Scope | null> {
  const perms = await getUserPermissions(userId);
  return perms.get(permissionCode) ?? null;
}

/** Kiểm tra user có permission với scope tối thiểu yêu cầu không.
 * C1: fail-closed — token phụ huynh (kind/role = 'parent') KHÔNG BAO GIỜ có permission staff,
 * kể cả khi parents.id trùng users.id của admin (namespace id tách biệt).
 * Nhận number (tương thích cũ) hoặc AuthUser (khuyến nghị — để kiểm tra kind).
 */
export async function hasPermission(
  user: number | AuthUser,
  permissionCode: string,
  minScope: Scope = 'own'
): Promise<boolean> {
  const userId = typeof user === 'number' ? user : user.id;
  if (typeof user !== 'number' && (user.kind === 'parent' || user.role === 'parent')) {
    return false;
  }
  const scope = await getPermissionScope(userId, permissionCode);
  if (!scope) return false;
  return SCOPE_RANK[scope] >= SCOPE_RANK[minScope];
}

/**
 * Kiểm tra quyền trên một resource cụ thể (vd: học viên có thuộc center của user không).
 * Dùng cho các API cần kiểm tra ownership.
 */
export async function canAccess(
  user: AuthUser,
  permissionCode: string,
  resource: { centerId?: number | null; ownerId?: number | null }
): Promise<boolean> {
  // C1: fail-closed cho token phụ huynh
  if (user.kind === 'parent' || user.role === 'parent') return false;
  const scope = await getPermissionScope(user.id, permissionCode);
  if (!scope) return false;
  if (scope === 'all') return true;
  if (scope === 'center') {
    // superadmin (center_id null) đã được 'all' bao; còn lại so center
    if (user.role === 'superadmin') return true;
    return resource.centerId != null && resource.centerId === user.center_id;
  }
  // scope 'own'
  if (resource.ownerId != null && resource.ownerId === user.id) return true;
  // teacher_id link: giáo viên sở hữu dữ liệu lớp mình dạy
  if (user.teacher_id != null && resource.ownerId != null && resource.ownerId === user.teacher_id)
    return true;
  return false;
}

/** Seed permissions + system roles vào DB (idempotent). */
export async function seedAuthorization(): Promise<void> {
  for (const p of PERMISSIONS) {
    await db
      .prepare(
        `INSERT INTO permissions (code, name, description, module)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, description = excluded.description, module = excluded.module`
      )
      .run(p.code, p.name, p.description, p.module);
  }

  for (const role of SYSTEM_ROLES) {
    const r = await db
      .prepare(
        `INSERT INTO roles (code, name, description, is_system)
       VALUES (?, ?, ?, TRUE)
       ON CONFLICT (code) WHERE center_id IS NULL DO UPDATE SET name = excluded.name, description = excluded.description
       RETURNING id`
      )
      .run(role.code, role.name, role.description);
    // Lấy id (có thể đã tồn tại)
    const row = (await db
      .prepare('SELECT id FROM roles WHERE code = ? AND center_id IS NULL')
      .get(role.code)) as { id: number };
    const roleId = Number(r.lastInsertRowid || row.id);

    for (const [permCode, scope] of Object.entries(role.permissions)) {
      const permRow = (await db.prepare('SELECT id FROM permissions WHERE code = ?').get(permCode)) as
        | {
            id: number;
          }
        | undefined;
      if (!permRow) continue;
      await db
        .prepare(
          `INSERT INTO role_permissions (role_id, permission_id, scope)
         VALUES (?, ?, ?)
         ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = excluded.scope`
        )
        .run(roleId, permRow.id, scope);
    }
  }
  invalidateAllPermissions();
}

/**
 * SEC-1/S-2: caller không phải superadmin chỉ được trao (cấp cho role, hoặc gán/gỡ role chứa) các quyền
 * mình đang có, tới tối đa scope của mình; không bao giờ scope 'all' hay quyền system.*.
 */
export async function assertWithinCallerPerms(items: UserPermission[], caller: AuthUser): Promise<void> {
  if (caller.role === 'superadmin') return;
  const own = await getUserPermissions(caller.id);
  for (const it of items) {
    const mine = own.get(it.code);
    if (
      it.scope === 'all' ||
      it.code.startsWith('system.') ||
      !mine ||
      SCOPE_RANK[it.scope] > SCOPE_RANK[mine]
    ) {
      throw AppError.forbidden(
        `Không được cấp quyền ${it.code} với phạm vi ${it.scope} (vượt quyền của bạn)`
      );
    }
  }
}

/**
 * J-A1: caller (không phải superadmin) chỉ được chiếm/đặt lại tài khoản mà mọi quyền của nó caller cũng có
 * (scope ≥). Khác assertWithinCallerPerms: không cấm system.* — admin vẫn reset được admin cùng trung tâm.
 */
export async function assertCoversUserPerms(targetUserId: number, caller: AuthUser): Promise<void> {
  if (caller.role === 'superadmin') return;
  const own = await getUserPermissions(caller.id);
  for (const [code, scope] of await getUserPermissions(targetUserId)) {
    const mine = own.get(code);
    if (!mine || SCOPE_RANK[scope] > SCOPE_RANK[mine]) {
      throw AppError.forbidden(`Tài khoản đích có quyền ${code} (${scope}) vượt quyền của bạn`);
    }
  }
}

/**
 * Gán permissions cho role (thay thế toàn bộ).
 * Logic nghiệp vụ ở service-layer; route chỉ parse input.
 * Chống leo thang (SEC-1): người gán (caller) không phải superadmin thì
 * - không được cấp scope 'all' và không được cấp quyền system.*;
 * - mỗi quyền chỉ cấp tới tối đa scope chính caller đang có (không có quyền đó -> từ chối).
 */
export async function setRolePermissions(
  roleId: number,
  items: unknown,
  caller: AuthUser
): Promise<{ count: number; permissions: UserPermission[] }> {
  if (!Array.isArray(items)) throw AppError.badRequest('permissions phải là mảng {code, scope}');
  const clean: UserPermission[] = [];
  for (const it of items as { code?: unknown; scope?: unknown }[]) {
    if (!it || typeof it.code !== 'string' || typeof it.scope !== 'string' || !(it.scope in SCOPE_RANK)) {
      throw AppError.badRequest('Mỗi quyền phải có dạng {code, scope} với scope own|center|all');
    }
    clean.push({ code: it.code, scope: it.scope as Scope });
  }
  const role = (await db.prepare('SELECT is_system FROM roles WHERE id = ?').get(roleId)) as
    { is_system: boolean } | undefined;
  if (!role) throw AppError.notFound('Không tìm thấy vai trò');
  if (role.is_system) throw AppError.badRequest('Không được sửa quyền của vai trò hệ thống');
  // N-4: cả quyền MỚI lẫn quyền role đang có — người được ủy quyền không tước được quyền mình không có
  await assertWithinCallerPerms([...clean, ...(await rolePermissions(roleId))], caller);
  let count = 0;
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    for (const item of clean) {
      const perm = (await tx.prepare('SELECT id FROM permissions WHERE code = ?').get(item.code)) as
        { id: number } | undefined;
      if (!perm) continue;
      await tx
        .prepare(
          `INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)
           ON CONFLICT (role_id, permission_id) DO UPDATE SET scope = excluded.scope`
        )
        .run(roleId, perm.id, item.scope);
      count++;
    }
  });
  invalidateAllPermissions();
  return { count, permissions: clean };
}

/* ---------------- Quản trị roles (ARCH-3: SQL chuyển từ roles.routes.ts) ---------------- */

interface RoleRow {
  id: number;
  code: string;
  is_system: boolean;
  center_id: number | null;
}

/** Danh mục tất cả permissions (để UI hiển thị). */
export async function listPermissionCatalog(): Promise<unknown[]> {
  return db
    .prepare('SELECT id, code, name, description, module FROM permissions ORDER BY module, code')
    .all();
}

/** Roles hệ thống + roles của trung tâm cid (kèm số permissions, số users). */
export async function listRoles(cid: number | null): Promise<unknown[]> {
  return db
    .prepare(
      `SELECT r.id, r.code, r.name, r.description, r.is_system, r.center_id,
        (SELECT COUNT(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) as perm_count,
        (SELECT COUNT(*)::int FROM user_roles ur WHERE ur.role_id = r.id) as user_count
       FROM roles r
       WHERE r.center_id IS NULL OR r.center_id IS NOT DISTINCT FROM ?
       ORDER BY r.is_system DESC, r.name`
    )
    .all(cid);
}

/** Role xem được: hệ thống hoặc thuộc cid (cid null = superadmin). Role của trung tâm khác -> 404. */
async function getVisibleRole(cid: number | null, id: number): Promise<RoleRow> {
  const role = (await db.prepare('SELECT * FROM roles WHERE id = ?').get(id)) as RoleRow | undefined;
  if (!role || (cid !== null && role.center_id !== null && role.center_id !== cid)) {
    throw AppError.notFound('Không tìm thấy vai trò');
  }
  return role;
}

/** Custom role sửa được: không phải hệ thống, thuộc trung tâm cid (superadmin: mọi trung tâm). */
export async function getEditableRole(cid: number | null, id: number, systemMsg: string): Promise<RoleRow> {
  const role = (await db.prepare('SELECT id, code, is_system, center_id FROM roles WHERE id = ?').get(id)) as
    RoleRow | undefined;
  if (!role) throw AppError.notFound('Không tìm thấy vai trò');
  if (role.is_system) throw AppError.badRequest(systemMsg);
  if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
  return role;
}

async function rolePermissions(
  roleId: number
): Promise<{ code: string; name: string; module: string; scope: Scope }[]> {
  return (await db
    .prepare(
      `SELECT p.code, p.name, p.module, rp.scope
       FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ? ORDER BY p.module, p.code`
    )
    .all(roleId)) as { code: string; name: string; module: string; scope: Scope }[];
}

export async function getRoleDetail(cid: number | null, id: number): Promise<Record<string, unknown>> {
  const role = await getVisibleRole(cid, id);
  return { ...role, permissions: await rolePermissions(id) };
}

export async function createRole(
  centerId: number | null,
  input: { code: string; name: string; description?: string | null },
  actor: AuditActor
): Promise<{ id: number; code: string }> {
  const code = input.code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  // Không cho trùng mã role hệ thống: users.role = 'admin' chỉ trỏ role hệ thống, custom 'admin' gây nhầm lẫn
  if (SYSTEM_ROLES.some((r) => r.code === code)) throw AppError.conflict('Mã vai trò trùng vai trò hệ thống');
  let id: number;
  try {
    const r = await db
      .prepare('INSERT INTO roles (code, name, description, center_id) VALUES (?, ?, ?, ?)')
      .run(code, input.name, input.description ?? null, centerId);
    id = Number(r.lastInsertRowid);
  } catch (err) {
    // Chỉ unique violation mới là "trùng mã"; lỗi khác để errorHandler trả 500 + log
    if ((err as { code?: string }).code === '23505') throw AppError.conflict('Mã vai trò đã tồn tại');
    throw err;
  }
  await audit({
    centerId,
    actor,
    action: 'create',
    entity: 'roles',
    entityId: id,
    summary: `Tạo vai trò ${code}`,
  });
  return { id, code };
}

export async function updateRole(
  cid: number | null,
  id: number,
  input: { name?: string | null; description?: string | null }
): Promise<void> {
  await getEditableRole(cid, id, 'Không được sửa vai trò hệ thống');
  await db
    .prepare('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
    .run(input.name ?? null, input.description ?? null, id);
}

export async function deleteRole(
  cid: number | null,
  id: number,
  caller: AuthUser,
  actor: AuditActor
): Promise<void> {
  const role = await getEditableRole(cid, id, 'Không được xóa vai trò hệ thống');
  // N-4: xóa role = tước mọi quyền của nó khỏi người đang giữ -> chỉ khi caller có đủ các quyền đó
  await assertWithinCallerPerms(await rolePermissions(id), caller);
  await db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  invalidateAllPermissions();
  // Audit xóa role (thao tác phân quyền nhạy cảm)
  await audit({
    centerId: role.center_id,
    actor,
    action: 'delete',
    entity: 'roles',
    entityId: id,
    summary: `Xóa vai trò #${id}`,
  });
}

/**
 * Kiểm tra trước khi gán/gỡ role cho user: role hệ thống chỉ superadmin; role và user cùng trung tâm cid;
 * S-2: quyền trong role phải nằm trong quyền của caller (người được ủy quyền roles.manage không tự
 * gán role "Kế toán" mạnh hơn mình).
 */
async function checkRoleAssignment(
  cid: number | null,
  userId: number,
  roleId: number,
  caller: AuthUser,
  verb: 'gán' | 'gỡ'
): Promise<{ center_id: number | null }> {
  const role = (await db.prepare('SELECT id, is_system, center_id FROM roles WHERE id = ?').get(roleId)) as
    RoleRow | undefined;
  if (!role) throw AppError.notFound('Không tìm thấy vai trò');
  if (role.is_system && caller.role !== 'superadmin') {
    throw AppError.forbidden(`Chỉ superadmin được ${verb} role hệ thống`);
  }
  if (cid !== null && role.center_id !== cid) throw AppError.notFound('Không tìm thấy vai trò');
  const target = (await db.prepare('SELECT id, center_id FROM users WHERE id = ?').get(userId)) as
    { id: number; center_id: number | null } | undefined;
  if (!target || (cid !== null && target.center_id !== cid))
    throw AppError.notFound('Không tìm thấy người dùng');
  await assertWithinCallerPerms(await rolePermissions(roleId), caller);
  return target;
}

export async function assignRole(
  cid: number | null,
  userId: number,
  roleId: number,
  caller: AuthUser,
  actor: AuditActor
): Promise<void> {
  const target = await checkRoleAssignment(cid, userId, roleId, caller, 'gán');
  await db
    .prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .run(userId, roleId);
  invalidateUserPermissions(userId);
  await audit({
    centerId: target.center_id,
    actor,
    action: 'update',
    entity: 'user_roles',
    entityId: userId,
    summary: `Gán vai trò #${roleId} cho người dùng #${userId}`,
    meta: { role_id: roleId },
  });
}

export async function unassignRole(
  cid: number | null,
  userId: number,
  roleId: number,
  caller: AuthUser,
  actor: AuditActor
): Promise<void> {
  const target = await checkRoleAssignment(cid, userId, roleId, caller, 'gỡ');
  await db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(userId, roleId);
  invalidateUserPermissions(userId);
  await audit({
    centerId: target.center_id,
    actor,
    action: 'update',
    entity: 'user_roles',
    entityId: userId,
    summary: `Gỡ vai trò #${roleId} khỏi người dùng #${userId}`,
    meta: { role_id: roleId },
  });
}
