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

  const roleCodes = [userRow.role];
  const extraRoles = (await db
    .prepare(`SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`)
    .all(userId)) as { code: string }[];
  for (const r of extraRoles) roleCodes.push(r.code);

  const perms = new Map<string, Scope>();
  for (const code of [...new Set(roleCodes)]) {
    const rows = (await db
      .prepare(
        `SELECT p.code, rp.scope FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = ?`
      )
      .all(code)) as { code: string; scope: Scope }[];
    for (const row of rows) {
      const cur = perms.get(row.code);
      if (!cur || SCOPE_RANK[row.scope] > SCOPE_RANK[cur]) {
        perms.set(row.code, row.scope);
      }
    }
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
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, description = excluded.description
       RETURNING id`
      )
      .run(role.code, role.name, role.description);
    // Lấy id (có thể đã tồn tại)
    const row = (await db.prepare('SELECT id FROM roles WHERE code = ?').get(role.code)) as { id: number };
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
 * Gán permissions cho role (thay thế toàn bộ).
 * Logic nghiệp vụ ở service-layer; route chỉ parse input.
 */
export async function setRolePermissions(
  roleId: number,
  items: { code: string; scope: string }[]
): Promise<{ count: number }> {
  const role = (await db.prepare('SELECT is_system FROM roles WHERE id = ?').get(roleId)) as
    { is_system: boolean } | undefined;
  if (!role) throw AppError.notFound('Không tìm thấy vai trò');
  if (role.is_system) throw AppError.badRequest('Không được sửa quyền của vai trò hệ thống');
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    for (const item of items) {
      const perm = (await tx.prepare('SELECT id FROM permissions WHERE code = ?').get(item.code)) as
        { id: number } | undefined;
      if (!perm) continue;
      const scope = ['own', 'center', 'all'].includes(item.scope) ? item.scope : 'center';
      await tx
        .prepare('INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)')
        .run(roleId, perm.id, scope);
    }
  });
  invalidateAllPermissions();
  return { count: items.length };
}
