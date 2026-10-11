/**
 * Test khóa P0-1: custom role own-scope không được bypass lọc "lớp của tôi".
 * Kịch bản: user role chính 'staff' + custom role 'tro_ly' gán 'homework.delete'
 * scope 'own' (permission mà staff không có) — trước fix, check literal
 * `role === 'teacher'` bị skip nên user này thấy/xóa bài của TẤT CẢ lớp.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import type { AuthRequest } from '../../middleware/auth';
import { ownScoped, type ScopeCtx } from '../../shared/scope';
import { seedAuthorization, invalidateAllPermissions } from '../authorization/authorization.service';
import * as homeworkService from './homework.service';
import * as gradesService from '../grades/grades.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let teacher1Id = 0;
let teacher2Id = 0;
let classAId = 0;
let classBId = 0;
let staffId = 0;
let teacherUserId = 0;
let customUserId = 0;
let studentId = 0;
let gradeBId = 0;
/** v22 chk_users_center: user không phải superadmin bắt buộc thuộc 1 trung tâm — mọi fixture cùng trung tâm này. */
let centerId = 0;

function fakeReq(userId: number | null): AuthRequest {
  return { user: userId === null ? undefined : ({ id: userId } as AuthRequest['user']) } as AuthRequest;
}

async function resetDb(): Promise<void> {
  await resetTestDb();
  await seedAuthorization();
  const c = await db.prepare("INSERT INTO centers (name) VALUES ('TT Scope')").run();
  centerId = Number(c.lastInsertRowid);

  const t1 = await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV 1', ?)").run(centerId);
  teacher1Id = Number(t1.lastInsertRowid);
  const t2 = await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV 2', ?)").run(centerId);
  teacher2Id = Number(t2.lastInsertRowid);

  const cA = await db
    .prepare('INSERT INTO classes (name, teacher_id, center_id) VALUES (?, ?, ?)')
    .run('Lớp A', teacher1Id, centerId);
  classAId = Number(cA.lastInsertRowid);
  const cB = await db
    .prepare('INSERT INTO classes (name, teacher_id, center_id) VALUES (?, ?, ?)')
    .run('Lớp B', teacher2Id, centerId);
  classBId = Number(cB.lastInsertRowid);

  const s = await db
    .prepare(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('staff1', 'x', 'staff', 'NV 1', ?)"
    )
    .run(centerId);
  staffId = Number(s.lastInsertRowid);
  const tu = await db
    .prepare(
      "INSERT INTO users (username, password_hash, role, name, teacher_id, center_id) VALUES ('gv1', 'x', 'teacher', 'GV 1', ?, ?)"
    )
    .run(teacher1Id, centerId);
  teacherUserId = Number(tu.lastInsertRowid);
  // User custom role: role chính 'staff', KHÔNG link teacher (teacher_id null), cùng trung tâm
  const cu = await db
    .prepare(
      "INSERT INTO users (username, password_hash, role, name, center_id) VALUES ('troly', 'x', 'staff', 'Trợ lý', ?)"
    )
    .run(centerId);
  customUserId = Number(cu.lastInsertRowid);

  // Custom role 'tro_ly' của trung tâm: 'homework.delete' scope 'own' (staff/teacher đều không có quyền này)
  const r = await db
    .prepare("INSERT INTO roles (code, name, description, center_id) VALUES ('tro_ly', 'Trợ lý', '', ?)")
    .run(centerId);
  const roleId = Number(r.lastInsertRowid);
  const perm = (await db.prepare("SELECT id FROM permissions WHERE code = 'homework.delete'").get()) as {
    id: number;
  };
  await db
    .prepare('INSERT INTO role_permissions (role_id, permission_id, scope) VALUES (?, ?, ?)')
    .run(roleId, perm.id, 'own');
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(customUserId, roleId);
  invalidateAllPermissions();

  // Bài tập + điểm ở cả 2 lớp
  await homeworkService.createHomeworkBatch({
    class_ids: [classAId],
    title: 'Bài lớp A',
    created_by: staffId,
    centerId,
  });
  await homeworkService.createHomeworkBatch({
    class_ids: [classBId],
    title: 'Bài lớp B',
    created_by: staffId,
    centerId,
  });
  const st = await db
    .prepare("INSERT INTO students (code, name, center_id) VALUES ('ST1', 'HV 1', ?)")
    .run(centerId);
  studentId = Number(st.lastInsertRowid);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classAId);
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, classBId);
  await gradesService.createGrade({
    centerId,
    student_id: studentId,
    class_id: classAId,
    title: 'KT A',
    score: 8,
    max_score: 10,
    created_by: staffId,
    role: 'staff',
    teacher_id: null,
    ownOnly: false,
  });
  const gB = await gradesService.createGrade({
    centerId,
    student_id: studentId,
    class_id: classBId,
    title: 'KT B',
    score: 7,
    max_score: 10,
    created_by: staffId,
    role: 'staff',
    teacher_id: null,
    ownOnly: false,
  });
  gradeBId = gB.id;
}

function ctx(over: Partial<ScopeCtx>): ScopeCtx {
  return { centerId, role: 'staff', teacherId: null, ...over };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

describe('P0-1: ownScoped theo permission scope (không theo role literal)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('custom role scope own (dù role chính là staff) → ownScoped true', async () => {
    assert.equal(await ownScoped(fakeReq(customUserId), 'homework.delete'), true);
  });

  it('staff scope center → ownScoped false; teacher scope own → true', async () => {
    assert.equal(await ownScoped(fakeReq(staffId), 'homework.view'), false);
    assert.equal(await ownScoped(fakeReq(teacherUserId), 'homework.view'), true);
  });

  it('không có user → ownScoped false', async () => {
    assert.equal(await ownScoped(fakeReq(null), 'homework.view'), false);
  });
});

describe('P0-1: listHomework với ownOnly', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('custom role own-scope + teacher_id null → không thấy bài lớp nào', async () => {
    const res = await homeworkService.listHomework(ctx({ ownOnly: true }), {}, {});
    assert.equal(res.pagination.total, 0);
    assert.equal(res.data.length, 0);
  });

  it('teacher own-scope → chỉ thấy bài lớp mình dạy (hành vi cũ giữ nguyên)', async () => {
    const res = await homeworkService.listHomework(
      ctx({ role: 'teacher', teacherId: teacher1Id, ownOnly: true }),
      {},
      {}
    );
    assert.equal(res.pagination.total, 1);
    assert.equal(res.data[0].title, 'Bài lớp A');
  });

  it('staff (không ownOnly) → vẫn thấy tất cả bài', async () => {
    const res = await homeworkService.listHomework(ctx({}), {}, {});
    assert.equal(res.pagination.total, 2);
  });
});

describe('P0-1: listGrades với ownOnly', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('custom role own-scope + teacher_id null → không thấy điểm nào', async () => {
    const res = await gradesService.listGrades(ctx({ ownOnly: true }), {}, {});
    assert.equal(res.pagination.total, 0);
  });

  it('teacher own-scope → chỉ thấy điểm lớp mình dạy', async () => {
    const res = await gradesService.listGrades(
      ctx({ role: 'teacher', teacherId: teacher2Id, ownOnly: true }),
      {},
      {}
    );
    assert.equal(res.pagination.total, 1);
    assert.equal(res.data[0].title, 'KT B');
  });
});

describe('P0-1: createGrade/deleteGrade với ownOnly', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('custom role own-scope + teacher_id null → không nhập điểm lớp khác được', async () => {
    await assert.rejects(
      gradesService.createGrade({
        centerId,
        student_id: studentId,
        class_id: classBId,
        title: 'KT lén',
        score: 9,
        max_score: 10,
        created_by: customUserId,
        role: 'staff',
        teacher_id: null,
        ownOnly: true,
      }),
      /chỉ được nhập điểm cho lớp của mình/
    );
  });

  it('custom role own-scope + teacher_id null → không xóa điểm lớp khác được', async () => {
    await assert.rejects(
      gradesService.deleteGrade(centerId, gradeBId, null, true),
      /chỉ được xóa điểm của lớp mình/
    );
    // Điểm vẫn còn nguyên
    const row = (await db.prepare('SELECT id FROM grades WHERE id = ?').get(gradeBId)) as
      { id: number } | undefined;
    assert.ok(row);
  });

  it('staff (ownOnly false) → nhập/xóa điểm bình thường', async () => {
    const g = await gradesService.createGrade({
      centerId,
      student_id: studentId,
      class_id: classBId,
      title: 'KT NV',
      score: 6,
      max_score: 10,
      created_by: staffId,
      role: 'staff',
      teacher_id: null,
      ownOnly: false,
    });
    assert.ok(g.id > 0);
    await gradesService.deleteGrade(centerId, g.id, null, false);
  });
});
