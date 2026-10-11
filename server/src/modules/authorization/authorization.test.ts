/**
 * Test hệ thống phân quyền (RBAC) trên PostgreSQL:
 * - Seed permission catalog + system roles (idempotent)
 * - hasPermission/getPermissionScope cho từng system role
 * - Scope mạnh nhất thắng khi user có nhiều roles
 * - Custom role: tạo, gán quyền, gán cho user, thu hồi
 * - System role không xóa/sửa được (ràng buộc ở API, kiểm tra flag)
 * - Middleware requirePermission: cho qua / chặn 403 đúng
 * - canAccess: kiểm tra center/own scope
 */
// LƯU Ý: chạy với DATABASE_URL trỏ tới test DB (xem db/test-utils.ts)

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import {
  seedAuthorization,
  hasPermission,
  getPermissionScope,
  canAccess,
  getUserPermissions,
  invalidateAllPermissions,
  setRolePermissions,
  createRole,
} from './authorization.service';
import { requirePermission } from './authorization.middleware';
import { PERMISSIONS, SYSTEM_ROLES } from './permissions';

let testCenterId: number | null = null;

async function ensureCenter(): Promise<number> {
  if (testCenterId) return testCenterId;
  const existing = (await db.prepare('SELECT id FROM centers LIMIT 1').get()) as { id: number } | undefined;
  if (existing) {
    testCenterId = Number(existing.id);
    return testCenterId;
  }
  const r = await db.prepare("INSERT INTO centers (name) VALUES ('TT Test')").run();
  testCenterId = Number(r.lastInsertRowid);
  return testCenterId;
}

async function createUser(username: string, role: string, centerId: number | null = null): Promise<number> {
  const cid = role === 'superadmin' ? null : (centerId ?? (await ensureCenter()));
  const r = await db
    .prepare('INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, ?, ?, ?)')
    .run(username, 'hash', role, username, cid);
  return Number(r.lastInsertRowid);
}

describe('authorization (RBAC)', () => {
  before(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    testCenterId = null;
    invalidateAllPermissions();
    await seedAuthorization();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('seed đủ permission catalog và system roles (idempotent)', async () => {
    const pc = (await db.prepare('SELECT COUNT(*) as c FROM permissions').get()) as { c: number };
    assert.equal(Number(pc.c), PERMISSIONS.length);
    const rc = (await db.prepare('SELECT COUNT(*) as c FROM roles WHERE is_system = TRUE').get()) as {
      c: number;
    };
    assert.equal(Number(rc.c), SYSTEM_ROLES.length);
    // Chạy lại vẫn idempotent
    await seedAuthorization();
    const pc2 = (await db.prepare('SELECT COUNT(*) as c FROM permissions').get()) as { c: number };
    assert.equal(Number(pc2.c), PERMISSIONS.length);
  });

  it('superadmin có mọi quyền với scope all', async () => {
    const id = await createUser('root1', 'superadmin', null);
    assert.equal(await hasPermission(id, 'students.delete'), true);
    assert.equal(await hasPermission(id, 'system.manage'), true);
    assert.equal(await getPermissionScope(id, 'students.view'), 'all');
  });

  it('admin có mọi quyền với scope center', async () => {
    const id = await createUser('admin1', 'admin');
    assert.equal(await hasPermission(id, 'students.delete'), true);
    assert.equal(await hasPermission(id, 'payroll.manage'), true);
    assert.equal(await getPermissionScope(id, 'students.view'), 'center');
    assert.equal(await hasPermission(id, 'students.view', 'all'), false);
  });

  it('staff bị giới hạn đúng: không xóa, không lương, không cấu hình', async () => {
    const id = await createUser('staff1', 'staff');
    assert.equal(await hasPermission(id, 'students.view'), true);
    assert.equal(await hasPermission(id, 'students.create'), true);
    assert.equal(await hasPermission(id, 'students.delete'), false);
    assert.equal(await hasPermission(id, 'payroll.manage'), false);
    assert.equal(await hasPermission(id, 'payroll.view'), true);
    assert.equal(await hasPermission(id, 'settings.manage'), false);
    assert.equal(await hasPermission(id, 'payments.approve'), true);
    assert.equal(await hasPermission(id, 'system.manage'), false);
  });

  it('teacher chỉ có quyền trên dữ liệu của mình (scope own)', async () => {
    const id = await createUser('teacher1', 'teacher');
    assert.equal(await getPermissionScope(id, 'attendance.take'), 'own');
    assert.equal(await getPermissionScope(id, 'homework.grade'), 'own');
    assert.equal(await hasPermission(id, 'students.delete'), false);
    assert.equal(await hasPermission(id, 'invoices.view'), false);
    assert.equal(await hasPermission(id, 'payroll.view_self'), true);
  });

  it('scope mạnh nhất thắng khi user có nhiều roles', async () => {
    const id = await createUser('multi1', 'teacher');
    // Tạo custom role có students.view scope center, gán cho user
    const rr = await db.prepare("INSERT INTO roles (code, name) VALUES ('troly', 'Trợ lý')").run();
    const roleId = Number(rr.lastInsertRowid);
    const perm = (await db.prepare("SELECT id FROM permissions WHERE code = 'students.view'").get()) as {
      id: number;
    };
    await db
      .prepare('INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)')
      .run(roleId, perm.id, 'center');
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId);
    invalidateAllPermissions();
    // teacher cho students.view scope own, custom role cho scope center -> center thắng
    assert.equal(await getPermissionScope(id, 'students.view'), 'center');
  });

  it('thu hồi custom role thì mất quyền', async () => {
    const id = await createUser('multi2', 'teacher');
    const rr = await db.prepare("INSERT INTO roles (code, name) VALUES ('troly2', 'Trợ lý 2')").run();
    const roleId = Number(rr.lastInsertRowid);
    const perm = (await db.prepare("SELECT id FROM permissions WHERE code = 'invoices.view'").get()) as {
      id: number;
    };
    await db
      .prepare('INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)')
      .run(roleId, perm.id, 'center');
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId);
    invalidateAllPermissions();
    assert.equal(await hasPermission(id, 'invoices.view'), true);
    await db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(id, roleId);
    invalidateAllPermissions();
    assert.equal(await hasPermission(id, 'invoices.view'), false);
  });

  it('canAccess: center scope chỉ cho dữ liệu cùng trung tâm', async () => {
    const cid = await ensureCenter();
    const id = await createUser('staff2', 'staff');
    const user = { id, username: 'staff2', role: 'staff', name: 'Staff', center_id: cid } as never;
    assert.equal(await canAccess(user, 'students.view', { centerId: cid }), true);
    assert.equal(await canAccess(user, 'students.view', { centerId: cid + 9999 }), false);
  });

  it('canAccess: superadmin qua được mọi center', async () => {
    const id = await createUser('root2', 'superadmin', null);
    const user = { id, username: 'root2', role: 'superadmin', name: 'Root', center_id: null } as never;
    assert.equal(await canAccess(user, 'students.view', { centerId: 999 }), true);
  });

  it('middleware requirePermission: cho qua khi đủ quyền, 403 khi thiếu', async () => {
    const adminId = await createUser('admin2', 'admin');
    const staffId = await createUser('staff3', 'staff');

    const mw = requirePermission('students.delete');
    const state = { status: 0, nextCalled: false };
    const res = {
      status: (c: number) => {
        state.status = c;
        return res;
      },
      json: () => res,
    } as never;
    const next = () => {
      state.nextCalled = true;
    };

    await mw({ user: { id: adminId } } as never, res, next);
    assert.equal(state.nextCalled, true);

    state.nextCalled = false;
    state.status = 0;
    await mw({ user: { id: staffId } } as never, res, next);
    assert.equal(state.nextCalled, false);
    assert.equal(state.status, 403);
  });

  it('middleware requirePermission: 401 khi thiếu user', async () => {
    const mw = requirePermission('students.view');
    let status = 0;
    const res = {
      status: (c: number) => {
        status = c;
        return res;
      },
      json: () => res,
    } as never;
    await mw({} as never, res, () => {});
    assert.equal(status, 401);
  });

  it('getUserPermissions trả về map đầy đủ cho admin', async () => {
    const id = await createUser('admin3', 'admin');
    const perms = await getUserPermissions(id);
    assert.equal(perms.size, PERMISSIONS.length);
  });

  it('B6-5: mã vai trò từ tên tiếng Việt bỏ dấu, gộp gạch dưới; chỉ ký tự lạ -> 400', async () => {
    const cid = await ensureCenter();
    const actor = { id: null, name: 'Admin', role: 'admin' };
    assert.equal((await createRole(cid, { code: '  Kế toán  B6 ', name: 'x' }, actor)).code, 'ke_toan_b6');
    assert.equal((await createRole(cid, { code: 'Đào__tạo--Đ', name: 'x' }, actor)).code, 'dao_tao_d');
    await assert.rejects(() => createRole(cid, { code: '!!!', name: 'x' }, actor), /Mã vai trò/);
  });

  it('SEC-1: setRolePermissions chặn non-superadmin cấp all / system.* / vượt scope của mình', async () => {
    const cid = await ensureCenter();
    const adminId = await createUser('adm_cap', 'admin');
    const staffId = await createUser('staff_cap', 'staff');
    const rootId = await createUser('root_cap', 'superadmin', null);
    const r = (await db
      .prepare("INSERT INTO roles (code, name, center_id) VALUES ('cap', 'Cap', ?) RETURNING id")
      .get(cid)) as { id: number };
    const admin = { id: adminId, role: 'admin', center_id: cid } as never;
    const staff = { id: staffId, role: 'staff', center_id: cid } as never;
    await assert.rejects(
      () => setRolePermissions(r.id, [{ code: 'users.update', scope: 'all' }], admin),
      /vượt quyền/
    );
    await assert.rejects(
      () => setRolePermissions(r.id, [{ code: 'system.manage', scope: 'center' }], admin),
      /vượt quyền/
    );
    // staff không có users.update -> không cấp được cho người khác
    await assert.rejects(
      () => setRolePermissions(r.id, [{ code: 'users.update', scope: 'own' }], staff),
      /vượt quyền/
    );
    await assert.rejects(() => setRolePermissions(r.id, { code: 'x' }, admin), /mảng/);
    assert.deepEqual(await setRolePermissions(r.id, [{ code: 'students.view', scope: 'center' }], admin), {
      count: 1,
      permissions: [{ code: 'students.view', scope: 'center' }],
    });
    const root = { id: rootId, role: 'superadmin', center_id: null } as never;
    assert.equal((await setRolePermissions(r.id, [{ code: 'users.update', scope: 'all' }], root)).count, 1);
  });

  it('SEC-1: user thường có role chứa scope all vẫn chỉ được center; custom role trùng code ở center khác không lẫn quyền', async () => {
    const cid = await ensureCenter();
    const other = Number(
      (await db.prepare("INSERT INTO centers (name) VALUES ('TT 2')").run()).lastInsertRowid
    );
    const id = await createUser('t_all', 'teacher');
    const perm = (await db.prepare("SELECT id FROM permissions WHERE code = 'invoices.view'").get()) as {
      id: number;
    };
    const mine = (await db
      .prepare("INSERT INTO roles (code, name, center_id) VALUES ('ketoan', 'KT', ?) RETURNING id")
      .get(cid)) as { id: number };
    const theirs = (await db
      .prepare("INSERT INTO roles (code, name, center_id) VALUES ('ketoan', 'KT', ?) RETURNING id")
      .get(other)) as { id: number };
    const del = (await db.prepare("SELECT id FROM permissions WHERE code = 'students.delete'").get()) as {
      id: number;
    };
    await db
      .prepare("INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, 'all')")
      .run(mine.id, perm.id);
    await db
      .prepare("INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, 'center')")
      .run(theirs.id, del.id);
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, mine.id);
    // Custom role code 'teacher' ở center khác không được cộng vào role chính 'teacher'
    const fake = (await db
      .prepare("INSERT INTO roles (code, name, center_id) VALUES ('teacher', 'Fake', ?) RETURNING id")
      .get(other)) as { id: number };
    await db
      .prepare("INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, 'center')")
      .run(fake.id, del.id);
    invalidateAllPermissions();
    assert.equal(await getPermissionScope(id, 'invoices.view'), 'center');
    assert.equal(await hasPermission(id, 'students.delete'), false);
  });
});
