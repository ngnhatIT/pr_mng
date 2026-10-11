/**
 * Integration test P0 red-team: luồng quên mật khẩu qua admin (chưa có email/SMS).
 * POST /auth/forgot-password -> admin GET /auth/reset-requests -> POST /auth/reset-requests/:id/process.
 *
 * Cần PostgreSQL (CI). Dùng node:http thuần, không thêm supertest.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
// Test đăng nhập nhiều lần từ cùng 1 IP — nới rate limit login (env đọc lúc load module)
process.env.LOGIN_RATE_LIMIT = '1000';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { seedAuthorization, invalidateAllPermissions } from '../authorization/authorization.service';
import { createApp } from '../../app';
import { env } from '../../config/env';

let port = 0;
let server: http.Server;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ADMIN_PASS = 'Matkhau123';

async function login(username: string): Promise<string> {
  const res = await request('POST', '/api/v1/auth/login', {}, { username, password: ADMIN_PASS });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body as { token: string }).token;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('quên mật khẩu qua admin', () => {
  before(async () => {
    await setupTestDb();
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as { port: number }).port;
  });
  beforeEach(async () => {
    await resetTestDb();
    invalidateAllPermissions();
    await seedAuthorization();
    await db
      .prepare("INSERT INTO centers (id, name, subdomain) VALUES (1, 'TT A', 'tta'), (2, 'TT B', 'ttb')")
      .run();
    const h = bcrypt.hashSync(ADMIN_PASS, 4);
    // Mỗi test dùng id user riêng (cache token check theo id sống qua các test)
    await db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES
         (1,'admin',?,'admin','Admin A',1), (2,'nv',?,'staff','NV A',1), (3,'adminb',?,'admin','Admin B',2)`
      )
      .run(h, h, h);
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await teardownTestDb();
  });

  it('gửi yêu cầu cho tài khoản không tồn tại vẫn trả ok (chống enumeration)', async () => {
    const res = await request(
      'POST',
      '/api/v1/auth/forgot-password',
      {},
      { kind: 'staff', username: 'ghost' }
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const row = (await db
      .prepare("SELECT identifier, kind, status, center_id FROM reset_requests WHERE identifier = 'ghost'")
      .get()) as { identifier: string; kind: string; status: string; center_id: number | null };
    assert.equal(row.kind, 'staff');
    assert.equal(row.status, 'pending');
    assert.equal(row.center_id, null, 'không xác định trung tâm -> chỉ superadmin thấy');
  });

  it('thiếu kind hoặc identifier -> 400', async () => {
    const res = await request('POST', '/api/v1/auth/forgot-password', {}, { username: 'admin' });
    assert.equal(res.status, 400);
  });

  it('admin xem danh sách và xử lý: sinh mật khẩu tạm, đá session cũ', async () => {
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'nv' });
    const token = await login('admin');

    const list = await request('GET', '/api/v1/auth/reset-requests', auth(token));
    assert.equal(list.status, 200);
    const rows = (list.body as { data: { id: number; identifier: string; kind: string; status: string }[] })
      .data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');

    const tv0 = (
      (await db.prepare('SELECT token_version FROM users WHERE id = 2').get()) as { token_version: number }
    ).token_version;
    const proc = await request('POST', `/api/v1/auth/reset-requests/${rows[0].id}/process`, auth(token), {});
    assert.equal(proc.status, 200);
    const tempPassword = (proc.body as { tempPassword?: string }).tempPassword;
    assert.ok(tempPassword && tempPassword.length >= 8, 'phải trả mật khẩu tạm đủ mạnh');

    const afterRow = (await db
      .prepare('SELECT password_hash, token_version FROM users WHERE id = 2')
      .get()) as {
      password_hash: string;
      token_version: number;
    };
    assert.ok(
      bcrypt.compareSync(tempPassword, afterRow.password_hash),
      'password_hash phải là mật khẩu tạm mới'
    );
    assert.equal(afterRow.token_version, tv0 + 1, 'token_version tăng để đá session cũ');
    const reqRow = (await db.prepare('SELECT status FROM reset_requests WHERE id = ?').get(rows[0].id)) as {
      status: string;
    };
    assert.equal(reqRow.status, 'processed');

    // Xử lý lại -> 400
    const again = await request('POST', `/api/v1/auth/reset-requests/${rows[0].id}/process`, auth(token), {});
    assert.equal(again.status, 400);
  });

  it('xử lý yêu cầu của tài khoản không tồn tại -> 404, yêu cầu vẫn pending', async () => {
    // Host tta -> yêu cầu gắn trung tâm A dù SĐT chưa có tài khoản
    await request(
      'POST',
      '/api/v1/auth/forgot-password',
      { host: 'tta.example.vn' },
      { kind: 'parent', phone: '0900000001' }
    );
    const token = await login('admin');
    const list = await request('GET', '/api/v1/auth/reset-requests', auth(token));
    const id = (list.body as { data: { id: number }[] }).data[0].id;
    const proc = await request('POST', `/api/v1/auth/reset-requests/${id}/process`, auth(token), {});
    assert.equal(proc.status, 404);
    const row = (await db.prepare('SELECT status FROM reset_requests WHERE id = ?').get(id)) as {
      status: string;
    };
    assert.equal(row.status, 'pending');
  });

  it('SEC-2: hai trung tâm — admin A không thấy/không xử lý được yêu cầu của B; phụ huynh trùng SĐT reset đúng tenant', async () => {
    const h = bcrypt.hashSync(ADMIN_PASS, 4);
    await db
      .prepare(
        "INSERT INTO parents (id, center_id, phone, password_hash, name) VALUES (11, 1, '0911111111', ?, 'PH A'), (12, 2, '0911111111', ?, 'PH B')"
      )
      .run(h, h);
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'adminb' });
    await request(
      'POST',
      '/api/v1/auth/forgot-password',
      { host: 'ttb.example.vn' },
      { kind: 'parent', phone: '+84911111111' }
    );

    const tokenA = await login('admin');
    const listA = await request('GET', '/api/v1/auth/reset-requests', auth(tokenA));
    assert.equal(listA.status, 200);
    assert.equal((listA.body as { data: unknown[] }).data.length, 0, 'admin A không thấy PII của B');

    const all = (await db.prepare('SELECT id, kind FROM reset_requests ORDER BY id').all()) as {
      id: number;
      kind: string;
    }[];
    for (const r of all) {
      const proc = await request('POST', `/api/v1/auth/reset-requests/${r.id}/process`, auth(tokenA), {});
      assert.equal(proc.status, 404, `admin A xử lý yêu cầu ${r.kind} của B phải 404`);
    }

    const tokenB = await login('adminb');
    const listB = await request('GET', '/api/v1/auth/reset-requests', auth(tokenB));
    assert.equal((listB.body as { data: unknown[] }).data.length, 2);
    const parentReq = all.find((r) => r.kind === 'parent')!;
    const tvOf = async (id: number) =>
      (
        (await db.prepare('SELECT token_version FROM parents WHERE id = ?').get(id)) as {
          token_version: number;
        }
      ).token_version;
    const [a0, b0] = [await tvOf(11), await tvOf(12)];
    const proc = await request(
      'POST',
      `/api/v1/auth/reset-requests/${parentReq.id}/process`,
      auth(tokenB),
      {}
    );
    assert.equal(proc.status, 200);
    assert.equal(await tvOf(11), a0, 'phụ huynh trung tâm A (trùng SĐT) không bị đụng');
    assert.equal(await tvOf(12), b0 + 1, 'phụ huynh trung tâm B được reset');
  });

  it('SEC-1: admin tự cấp users.update:all qua custom role không reset được tài khoản trung tâm khác', async () => {
    const tokenA = await login('admin');
    const role = await request('POST', '/api/v1/roles', auth(tokenA), { code: 'x', name: 'X' });
    assert.equal(role.status, 201);
    const roleId = (role.body as { id: number }).id;
    // Cấp scope 'all' -> bị từ chối
    const grantAll = await request('PUT', `/api/v1/roles/${roleId}/permissions`, auth(tokenA), {
      permissions: [{ code: 'users.update', scope: 'all' }],
    });
    assert.equal(grantAll.status, 403);
    // Quyền system.* cũng bị từ chối
    const grantSys = await request('PUT', `/api/v1/roles/${roleId}/permissions`, auth(tokenA), {
      permissions: [{ code: 'system.manage', scope: 'center' }],
    });
    assert.equal(grantSys.status, 403);
    // Payload sai kiểu -> 400 (không phải 500)
    const bad = await request('PUT', `/api/v1/roles/${roleId}/permissions`, auth(tokenA), {
      permissions: { a: 1 },
    });
    assert.equal(bad.status, 400);

    // Kể cả role có sẵn scope 'all' trong DB (dữ liệu cũ), user thường vẫn chỉ được 'center'
    const perm = (await db.prepare("SELECT id FROM permissions WHERE code = 'users.update'").get()) as {
      id: number;
    };
    await db
      .prepare("INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, 'all')")
      .run(roleId, perm.id);
    // S-2: gán role chứa scope 'all' bị chặn ngay ở /roles/assign (vượt quyền người gán)
    const assign = await request('POST', '/api/v1/roles/assign', auth(tokenA), {
      user_id: 1,
      role_id: roleId,
    });
    assert.equal(assign.status, 403);
    // Dữ liệu cũ đã lỡ gán: chèn thẳng DB để kiểm lớp chặn theo role ở reset-process
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (1, ?)').run(roleId);
    invalidateAllPermissions();

    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'adminb' });
    const r = (await db.prepare("SELECT id FROM reset_requests WHERE identifier = 'adminb'").get()) as {
      id: number;
    };
    // Giả lập yêu cầu bị gắn nhầm trung tâm A: vẫn phải chặn theo role (không theo scope)
    await db.prepare('UPDATE reset_requests SET center_id = 1 WHERE id = ?').run(r.id);
    const b0 = (
      (await db.prepare('SELECT token_version FROM users WHERE id = 3').get()) as { token_version: number }
    ).token_version;
    const proc = await request('POST', `/api/v1/auth/reset-requests/${r.id}/process`, auth(tokenA), {});
    assert.ok([403, 404].includes(proc.status), `phải bị chặn, nhận ${proc.status}`);
    assert.ok(!(proc.body as { tempPassword?: string }).tempPassword);
    const b = (await db.prepare('SELECT token_version FROM users WHERE id = 3').get()) as {
      token_version: number;
    };
    assert.equal(b.token_version, b0, 'tài khoản admin B không bị đổi');
    // Đã audit thay đổi phân quyền
    const audits = (await db
      .prepare("SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity IN ('roles', 'user_roles')")
      .get()) as {
      c: number;
    };
    assert.ok(audits.c >= 1); // tạo role (gán bị chặn — S-2)
  });

  it('không đăng nhập -> 401; staff thường không có quyền users.update -> 403', async () => {
    const noAuth = await request('GET', '/api/v1/auth/reset-requests');
    assert.equal(noAuth.status, 401);
    const staffToken = await login('nv');
    const denied = await request('GET', '/api/v1/auth/reset-requests', auth(staffToken));
    assert.equal(denied.status, 403);
  });

  it('login: user thường không gán trung tâm -> 403 NO_CENTER; password sai kiểu -> 400; trả center_name', async () => {
    const ok = await request('POST', '/api/v1/auth/login', {}, { username: 'admin', password: ADMIN_PASS });
    assert.equal((ok.body as { user: { center_name: string } }).user.center_name, 'TT A');
    const badType = await request(
      'POST',
      '/api/v1/auth/login',
      {},
      { username: 'admin', password: { $gt: '' } }
    );
    assert.equal(badType.status, 400);
    // Bỏ CHECK để mô phỏng dữ liệu cũ lệch
    await db.prepare('ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_center').run();
    await db
      .prepare(
        "INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (9,'orphan',?,'teacher','O',NULL)"
      )
      .run(bcrypt.hashSync(ADMIN_PASS, 4));
    const res = await request('POST', '/api/v1/auth/login', {}, { username: 'orphan', password: ADMIN_PASS });
    assert.equal(res.status, 403);
    assert.equal((res.body as { code: string }).code, 'NO_CENTER');
    await db.prepare('DELETE FROM users WHERE id = 9').run();
    await db
      .prepare(
        "ALTER TABLE users ADD CONSTRAINT chk_users_center CHECK (role = 'superadmin' OR center_id IS NOT NULL)"
      )
      .run();
  });

  it('logout-all: trả access token mới, token cũ bị thu hồi', async () => {
    const token = await login('nv');
    const res = await request('POST', '/api/v1/auth/logout-all', auth(token), {});
    assert.equal(res.status, 200);
    const fresh = (res.body as { token: string }).token;
    assert.ok(fresh && fresh !== token);
    const old = await request('GET', '/api/v1/auth/me', auth(token));
    assert.equal(old.status, 401, 'access token cũ (có thể bị lộ) chết ngay');
    const me = await request('GET', '/api/v1/auth/me', auth(fresh));
    assert.equal(me.status, 200);
    assert.equal((me.body as { user: { center_name: string } }).user.center_name, 'TT A');
  });

  it('xóa giáo viên -> tài khoản đăng nhập của GV bị khóa ngay', async () => {
    const t = Number(
      (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV', 1)").run()).lastInsertRowid
    );
    await db
      .prepare(
        "INSERT INTO users (id, username, password_hash, role, name, center_id, teacher_id) VALUES (5,'gv',?,'teacher','GV',1,?)"
      )
      .run(bcrypt.hashSync(ADMIN_PASS, 4), t);
    const gvToken = await login('gv');
    const del = await request('DELETE', `/api/v1/teachers/${t}`, auth(await login('admin')));
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(
      (await request('GET', '/api/v1/auth/me', auth(gvToken))).status,
      403,
      'token cũ bị chặn (tài khoản khóa)'
    );
    const relog = await request('POST', '/api/v1/auth/login', {}, { username: 'gv', password: ADMIN_PASS });
    assert.equal(relog.status, 403);
  });

  it('metrics + health chi tiết chỉ superadmin; /assets thiếu -> 404 (không trả index.html)', async () => {
    const token = await login('admin');
    assert.equal((await request('GET', '/api/v1/metrics', auth(token))).status, 403);
    assert.equal((await request('GET', '/api/v1/health', auth(token))).status, 403);
    const asset = await request('GET', '/assets/khong-ton-tai-abc123.js');
    assert.equal(asset.status, 404);
  });

  /** User mới với id riêng (cache token check theo id sống qua các test). */
  async function addUser(id: number, username: string, role: string): Promise<void> {
    await db
      .prepare(
        'INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (?, ?, ?, ?, ?, 1)'
      )
      .run(id, username, bcrypt.hashSync(ADMIN_PASS, 4), role, username);
  }

  /** Admin tạo custom role với danh sách quyền rồi gán cho user — trả role id. */
  async function grantRole(
    adminToken: string,
    userId: number,
    code: string,
    perms: { code: string; scope: string }[]
  ) {
    const role = await request('POST', '/api/v1/roles', auth(adminToken), { code, name: code });
    assert.equal(role.status, 201, JSON.stringify(role.body));
    const roleId = (role.body as { id: number }).id;
    const set = await request('PUT', `/api/v1/roles/${roleId}/permissions`, auth(adminToken), {
      permissions: perms,
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    if (userId) {
      const a = await request('POST', '/api/v1/roles/assign', auth(adminToken), {
        user_id: userId,
        role_id: roleId,
      });
      assert.equal(a.status, 200, JSON.stringify(a.body));
    }
    invalidateAllPermissions();
    return roleId;
  }

  it('S-2: nhân viên được ủy quyền users.update không reset được mật khẩu admin (hạng cao hơn)', async () => {
    await addUser(11, 'nv11', 'staff');
    const adminToken = await login('admin');
    await grantRole(adminToken, 11, 'hr', [
      { code: 'users.view', scope: 'center' },
      { code: 'users.update', scope: 'center' },
    ]);
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'admin' });
    const r = (await db.prepare("SELECT id FROM reset_requests WHERE identifier = 'admin'").get()) as {
      id: number;
    };
    const tv0 = (
      (await db.prepare('SELECT token_version FROM users WHERE id = 1').get()) as { token_version: number }
    ).token_version;
    const proc = await request(
      'POST',
      `/api/v1/auth/reset-requests/${r.id}/process`,
      auth(await login('nv11')),
      {}
    );
    assert.equal(proc.status, 403, JSON.stringify(proc.body));
    assert.ok(!(proc.body as { tempPassword?: string }).tempPassword);
    const after = (await db.prepare('SELECT token_version FROM users WHERE id = 1').get()) as {
      token_version: number;
    };
    assert.equal(after.token_version, tv0, 'mật khẩu admin không bị đổi');
    const st = (await db.prepare('SELECT status FROM reset_requests WHERE id = ?').get(r.id)) as {
      status: string;
    };
    assert.equal(st.status, 'pending');
  });

  it('J-A1: HR (users.update + roles.manage) không reset được kế toán cùng hạng staff nhưng có payments.refund', async () => {
    await addUser(21, 'hr2', 'staff');
    await addUser(22, 'acct2', 'staff');
    const adminToken = await login('admin');
    await grantRole(adminToken, 21, 'hr2role', [
      { code: 'users.view', scope: 'center' },
      { code: 'users.update', scope: 'center' },
      { code: 'roles.view', scope: 'center' },
      { code: 'roles.manage', scope: 'center' },
    ]);
    await grantRole(adminToken, 22, 'accountant', [{ code: 'payments.refund', scope: 'center' }]);
    // J-A9: gửi 2 lần -> chỉ 1 yêu cầu pending
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'acct2' });
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'acct2' });
    const rows = (await db.prepare("SELECT id FROM reset_requests WHERE identifier = 'acct2'").all()) as {
      id: number;
    }[];
    assert.equal(rows.length, 1, 'không tích lũy yêu cầu pending trùng');
    const path = `/api/v1/auth/reset-requests/${rows[0].id}/process`;
    const proc = await request('POST', path, auth(await login('hr2')), {});
    assert.equal(proc.status, 403, JSON.stringify(proc.body));
    assert.ok(!(proc.body as { tempPassword?: string }).tempPassword);
    // Admin (có mọi quyền center) vẫn xử lý được
    const ok = await request('POST', path, auth(adminToken), {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('S-2: người được ủy quyền roles.manage không tự gán role có quyền vượt mình', async () => {
    const adminToken = await login('admin');
    const ketoan = await grantRole(adminToken, 0, 'ketoan', [{ code: 'payments.refund', scope: 'center' }]);
    const sv = await grantRole(adminToken, 0, 'sv', [{ code: 'students.view', scope: 'center' }]);
    await addUser(12, 'nv12', 'staff');
    await grantRole(adminToken, 12, 'hr', [
      { code: 'roles.view', scope: 'center' },
      { code: 'roles.manage', scope: 'center' },
    ]);
    const nvToken = await login('nv12');
    const esc = await request('POST', '/api/v1/roles/assign', auth(nvToken), {
      user_id: 12,
      role_id: ketoan,
    });
    assert.equal(esc.status, 403, JSON.stringify(esc.body));
    const has = await db.prepare('SELECT 1 FROM user_roles WHERE user_id = 12 AND role_id = ?').get(ketoan);
    assert.equal(has, undefined);
    // Role nằm trong quyền của mình (staff có students.view center) -> được gán
    const ok = await request('POST', '/api/v1/roles/assign', auth(nvToken), { user_id: 12, role_id: sv });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('S-3: custom role scope own trên route không lọc own (GET /payroll) -> 403; scope center -> 200', async () => {
    await addUser(6, 'tl', 'teacher');
    const adminToken = await login('admin');
    const roleId = await grantRole(adminToken, 6, 'luong_own', [{ code: 'payroll.view', scope: 'own' }]);
    const tl = await login('tl');
    assert.equal((await request('GET', '/api/v1/payroll', auth(tl))).status, 403);
    await request('PUT', `/api/v1/roles/${roleId}/permissions`, auth(adminToken), {
      permissions: [{ code: 'payroll.view', scope: 'center' }],
    });
    invalidateAllPermissions();
    const ok = await request('GET', '/api/v1/payroll', auth(tl));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('ARCH-3: 2 admin xử lý cùng 1 yêu cầu song song -> chỉ 1 người nhận mật khẩu tạm', async () => {
    await addUser(14, 'nv14', 'staff');
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'nv14' });
    const r = (await db.prepare("SELECT id FROM reset_requests WHERE identifier = 'nv14'").get()) as {
      id: number;
    };
    const token = await login('admin');
    const results = await Promise.all(
      [0, 1, 2].map(() => request('POST', `/api/v1/auth/reset-requests/${r.id}/process`, auth(token), {}))
    );
    const ok = results.filter((x) => x.status === 200);
    assert.equal(ok.length, 1, results.map((x) => x.status).join(','));
    for (const x of results.filter((y) => y.status !== 200)) {
      assert.equal((x.body as { code: string }).code, 'ALREADY_PROCESSED');
    }
    const tp = (ok[0].body as { tempPassword: string }).tempPassword;
    const relog = await request('POST', '/api/v1/auth/login', {}, { username: 'nv14', password: tp });
    assert.equal(relog.status, 200, 'mật khẩu tạm của người thắng là mật khẩu thật');
  });

  it('CI-3: đổi mật khẩu — sai mk cũ / trùng / yếu -> 400; thành công -> token cũ chết, mk mới đăng nhập được', async () => {
    await addUser(13, 'nv13', 'staff');
    const token = await login('nv13');
    const cp = (body: unknown, t = token) => request('POST', '/api/v1/auth/change-password', auth(t), body);
    assert.equal((await cp({ old_password: 'sai-mat-khau', new_password: 'MatKhauMoi#2026' })).status, 400);
    const wrong = await cp({ old_password: 'sai-mat-khau', new_password: 'MatKhauMoi#2026' });
    assert.equal((wrong.body as { code: string }).code, 'WRONG_PASSWORD');
    const same = await cp({ old_password: ADMIN_PASS, new_password: ADMIN_PASS });
    assert.equal((same.body as { code: string }).code, 'SAME_PASSWORD');
    assert.equal((await cp({ old_password: ADMIN_PASS, new_password: '123' })).status, 400);
    assert.equal((await cp({ old_password: ADMIN_PASS })).status, 400);
    const tv0 = (
      (await db.prepare('SELECT token_version FROM users WHERE id = 13').get()) as { token_version: number }
    ).token_version;
    const ok = await cp({ old_password: ADMIN_PASS, new_password: 'MatKhauMoi#2026' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const tv1 = (
      (await db.prepare('SELECT token_version FROM users WHERE id = 13').get()) as { token_version: number }
    ).token_version;
    assert.equal(tv1, tv0 + 1);
    assert.equal(
      (await request('GET', '/api/v1/auth/me', auth(token))).status,
      401,
      'access token cũ bị thu hồi'
    );
    const oldPw = await request('POST', '/api/v1/auth/login', {}, { username: 'nv13', password: ADMIN_PASS });
    assert.equal(oldPw.status, 401);
    const newPw = await request(
      'POST',
      '/api/v1/auth/login',
      {},
      { username: 'nv13', password: 'MatKhauMoi#2026' }
    );
    assert.equal(newPw.status, 200);
    const audit = await db
      .prepare(
        "SELECT 1 FROM audit_logs WHERE entity = 'users' AND entity_id = 13 AND summary LIKE '%đổi mật khẩu%'"
      )
      .get();
    assert.ok(audit, 'có audit đổi mật khẩu');
  });

  it('S-4: đăng nhập thành công set device cookie ld (HttpOnly, path /api/v1/auth)', async () => {
    const res = await request('POST', '/api/v1/auth/login', {}, { username: 'admin', password: ADMIN_PASS });
    const cookies = [...(res.headers['set-cookie'] ?? [])].join('\n');
    assert.match(cookies, /(^|\n)ld=[^;]+;.*Path=\/api\/v1\/auth/i);
    assert.match(cookies, /(^|\n)ld=[^\n]*HttpOnly/i);
  });

  it('OPS-5: metrics nhận METRICS_TOKEN (Bearer) + label worker; token sai -> 401; /api/health có rate limit', async () => {
    const rec = env as unknown as Record<string, string>;
    const prev = rec.METRICS_TOKEN;
    rec.METRICS_TOKEN = 'm'.repeat(40);
    try {
      const ok = await request('GET', '/api/v1/metrics', { authorization: `Bearer ${'m'.repeat(40)}` });
      assert.equal(ok.status, 200);
      assert.match(String(ok.body), /educenter_uptime_seconds\{worker="\d+"\} \d+/);
      const bad = await request('GET', '/api/v1/metrics', { authorization: `Bearer ${'x'.repeat(40)}` });
      assert.equal(bad.status, 401);
    } finally {
      rec.METRICS_TOKEN = prev;
    }
    assert.equal((await request('GET', '/api/health')).status, 200);
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) limited = (await request('GET', '/api/health')).status === 429;
    assert.ok(limited, '/api/health phải bị giới hạn theo IP');
  });

  it('C-3/C-4: VNPay IPN dùng limiter riêng (không chung 300/IP); nộp bài phụ huynh có upload limiter', async () => {
    const ipn = await request('GET', '/api/v1/payments/vnpay-ipn');
    assert.equal(ipn.headers['x-ratelimit-limit'], '5000');
    await db
      .prepare(
        "INSERT INTO parents (id, center_id, phone, password_hash, name) VALUES (1, 1, '0912345678', ?, 'PH')"
      )
      .run(bcrypt.hashSync(ADMIN_PASS, 4));
    const pl = await request(
      'POST',
      '/api/v1/parent/login',
      {},
      { phone: '0912345678', password: ADMIN_PASS, center_id: 1 }
    );
    assert.equal(pl.status, 200, JSON.stringify(pl.body));
    assert.match(
      [...(pl.headers['set-cookie'] ?? [])].join('\n'),
      /(^|\n)ld=[^;]+;.*Path=\/api\/v1\/parent/i
    );
    const sub = await request(
      'POST',
      '/api/v1/parent/homework/1/submit',
      auth((pl.body as { token: string }).token),
      {}
    );
    assert.equal(sub.headers['x-ratelimit-limit'], '30', 'uploadRateLimit chạy trước multer');
  });

  it('N-4: người được ủy quyền roles.manage không tước/xóa được role có quyền mình không có', async () => {
    await addUser(41, 'hr41', 'staff');
    const adminToken = await login('admin');
    await grantRole(adminToken, 41, 'hr41role', [
      { code: 'roles.view', scope: 'center' },
      { code: 'roles.manage', scope: 'center' },
    ]);
    const ketoan = await grantRole(adminToken, 0, 'ketoan41', [{ code: 'payments.refund', scope: 'center' }]);
    const sv = await grantRole(adminToken, 0, 'sv41', [{ code: 'students.view', scope: 'center' }]);
    const hr = auth(await login('hr41'));
    const strip = await request('PUT', `/api/v1/roles/${ketoan}/permissions`, hr, { permissions: [] });
    assert.equal(strip.status, 403, JSON.stringify(strip.body));
    assert.equal((await request('DELETE', `/api/v1/roles/${ketoan}`, hr)).status, 403);
    const left = (await db
      .prepare('SELECT COUNT(*)::int AS c FROM role_permissions WHERE role_id = ?')
      .get(ketoan)) as { c: number };
    assert.equal(left.c, 1, 'quyền payments.refund của role vẫn còn');
    // Role nằm trong quyền của mình -> sửa/xóa được; admin xóa được role kế toán
    const edit = await request('PUT', `/api/v1/roles/${sv}/permissions`, hr, { permissions: [] });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal((await request('DELETE', `/api/v1/roles/${sv}`, hr)).status, 200);
    assert.equal((await request('DELETE', `/api/v1/roles/${ketoan}`, auth(adminToken))).status, 200);
  });

  it('N-5: mật khẩu tạm (đặt lại) -> 403 PASSWORD_CHANGE_REQUIRED trừ /auth/me + đổi mật khẩu; đổi xong dùng bình thường', async () => {
    await addUser(42, 'nv42', 'staff');
    await db
      .prepare(
        "INSERT INTO parents (id, center_id, phone, password_hash, name) VALUES (42, 1, '0912000042', ?, 'PH')"
      )
      .run(bcrypt.hashSync(ADMIN_PASS, 4));
    await request('POST', '/api/v1/auth/forgot-password', {}, { kind: 'staff', username: 'nv42' });
    await request(
      'POST',
      '/api/v1/auth/forgot-password',
      { host: 'tta.example.vn' },
      { kind: 'parent', phone: '0912000042' }
    );
    const adminToken = await login('admin');
    const temp: Record<string, string> = {};
    for (const r of (await db.prepare('SELECT id, kind FROM reset_requests').all()) as {
      id: number;
      kind: string;
    }[]) {
      const proc = await request('POST', `/api/v1/auth/reset-requests/${r.id}/process`, auth(adminToken), {});
      assert.equal(proc.status, 200, JSON.stringify(proc.body));
      temp[r.kind] = (proc.body as { tempPassword: string }).tempPassword;
    }

    // Staff
    const li = await request('POST', '/api/v1/auth/login', {}, { username: 'nv42', password: temp.staff });
    assert.equal(li.status, 200);
    const body = li.body as { token: string; user: { must_change_password: boolean } };
    assert.equal(body.user.must_change_password, true);
    const t = auth(body.token);
    const me = await request('GET', '/api/v1/auth/me', t);
    assert.equal(me.status, 200);
    assert.equal((me.body as { user: { must_change_password: boolean } }).user.must_change_password, true);
    assert.equal((await request('GET', '/api/auth/me', t)).status, 200, 'alias /api cũng được');
    for (const path of ['/api/v1/students', '/api/v1/dashboard/stats', '/api/students']) {
      const res = await request('GET', path, t);
      assert.equal(res.status, 403, path);
      assert.equal((res.body as { code: string }).code, 'PASSWORD_CHANGE_REQUIRED', path);
    }
    assert.equal((await request('POST', '/api/v1/auth/logout-all', t, {})).status, 403);
    const cp = await request('POST', '/api/v1/auth/change-password', t, {
      old_password: temp.staff,
      new_password: 'MatKhauMoi#2026',
    });
    assert.equal(cp.status, 200, JSON.stringify(cp.body));
    const flag = (await db.prepare('SELECT must_change_password AS f FROM users WHERE id = 42').get()) as {
      f: boolean;
    };
    assert.equal(flag.f, false);
    const li2 = await request(
      'POST',
      '/api/v1/auth/login',
      {},
      { username: 'nv42', password: 'MatKhauMoi#2026' }
    );
    const b2 = li2.body as { token: string; user: { must_change_password: boolean } };
    assert.equal(b2.user.must_change_password, false);
    assert.equal((await request('GET', '/api/v1/students', auth(b2.token))).status, 200);

    // Phụ huynh
    const pl = await request(
      'POST',
      '/api/v1/parent/login',
      {},
      { phone: '0912000042', password: temp.parent, center_id: 1 }
    );
    assert.equal(pl.status, 200, JSON.stringify(pl.body));
    const pb = pl.body as { token: string; parent: { must_change_password: boolean } };
    assert.equal(pb.parent.must_change_password, true);
    const ch = await request('GET', '/api/v1/parent/children', auth(pb.token));
    assert.equal((ch.body as { code: string }).code, 'PASSWORD_CHANGE_REQUIRED');
    const pcp = await request('POST', '/api/v1/parent/change-password', auth(pb.token), {
      old_password: temp.parent,
      new_password: 'MatKhauMoi#2026',
    });
    assert.equal(pcp.status, 200, JSON.stringify(pcp.body));
    const pf = (await db.prepare('SELECT must_change_password AS f FROM parents WHERE id = 42').get()) as {
      f: boolean;
    };
    assert.equal(pf.f, false);
  });
});
