/**
 * Chuông thông báo + thông báo chung (DB thật, migration v27): notifyParents đẩy chuông cho mọi phụ huynh
 * đã liên kết, nhân sự nhận theo permission (không lọt GV/tài khoản khóa/trung tâm khác), đọc/đọc hết chỉ
 * trên thông báo của mình, thông báo chung theo lớp chỉ tới phụ huynh của học viên đang học.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { seedAuthorization } from '../authorization/authorization.service';
import { notifyParents, staffWithPermission } from '../../services/notify';
import * as svc from './notifications.service';

let centerId = 0;
let otherCenter = 0;

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const center = (name: string) => id('INSERT INTO centers (name) VALUES (?)', name);
const user = (username: string, role: string, cid: number, active = true) =>
  id(
    "INSERT INTO users (username, password_hash, role, name, center_id, is_active) VALUES (?, 'x', ?, ?, ?, ?)",
    username,
    role,
    username,
    cid,
    active
  );
const parent = (phone: string, cid: number) =>
  id("INSERT INTO parents (phone, password_hash, name, center_id) VALUES (?, 'x', 'PH', ?)", phone, cid);
const student = (code: string, cid: number) =>
  id("INSERT INTO students (code, name, center_id) VALUES (?, 'HS', ?)", code, cid);

before(async () => {
  await setupTestDb();
});
after(teardownTestDb);

beforeEach(async () => {
  await resetTestDb();
  await seedAuthorization();
  centerId = await center('TT');
  otherCenter = await center('TT khác');
});

describe('notifications', () => {
  it('notifyParents đẩy chuông cho mọi phụ huynh liên kết; đọc/đọc hết chỉ trên thông báo của mình', async () => {
    const s = await student('HV1', centerId);
    const p1 = await parent('0900000001', centerId);
    const p2 = await parent('0900000002', centerId);
    const stranger = await parent('0900000003', centerId);
    for (const p of [p1, p2]) await db.prepare('INSERT INTO parent_students VALUES (?, ?)').run(p, s);

    await notifyParents(s, 'absence', 'Vắng', null, { params: { student: 'HS', date: '2026-10-10' } });
    const mine = await svc.listMine({ type: 'parent', id: p1 });
    assert.equal(mine.unread, 1);
    assert.equal(mine.data[0].kind, 'absence');
    assert.deepEqual(mine.data[0].params, { student: 'HS', date: '2026-10-10' });
    assert.equal(mine.data[0].link, `/parent/children/${s}`);
    assert.equal(await svc.unreadCount({ type: 'parent', id: stranger }), 0);

    await assert.rejects(svc.markRead({ type: 'parent', id: stranger }, mine.data[0].id), {
      statusCode: 404,
    });
    await assert.rejects(svc.markRead({ type: 'user', id: p1 }, mine.data[0].id), { statusCode: 404 });
    await svc.markRead({ type: 'parent', id: p1 }, mine.data[0].id);
    assert.equal(await svc.unreadCount({ type: 'parent', id: p1 }), 0);
    assert.equal(await svc.unreadCount({ type: 'parent', id: p2 }), 1);
    assert.equal(await svc.markAllRead({ type: 'parent', id: p2 }), 1);
    assert.equal((await svc.listMine({ type: 'parent', id: p2 }, { unreadOnly: true })).data.length, 0);
  });

  it('nhân sự nhận theo permission: admin/staff có, GV/tài khoản khóa/trung tâm khác không', async () => {
    const admin = await user('admin1', 'admin', centerId);
    const staff = await user('staff1', 'staff', centerId);
    await user('teacher1', 'teacher', centerId);
    await user('locked', 'staff', centerId, false);
    await user('admin2', 'admin', otherCenter);
    assert.deepEqual((await staffWithPermission(centerId, 'leaves.manage')).sort(), [admin, staff].sort());
    assert.deepEqual(await staffWithPermission(centerId, 'payroll.manage'), [admin]);
  });

  it('thông báo chung theo lớp chỉ tới phụ huynh học viên đang học; lớp trung tâm khác bị từ chối', async () => {
    const cls = await id("INSERT INTO classes (name, center_id) VALUES ('Lớp', ?)", centerId);
    const foreign = await id("INSERT INTO classes (name, center_id) VALUES ('Lớp', ?)", otherCenter);
    const active = await student('HV1', centerId);
    const left = await student('HV2', centerId);
    const pa = await parent('0900000011', centerId);
    const pb = await parent('0900000012', centerId);
    await db.prepare('INSERT INTO parent_students VALUES (?, ?), (?, ?)').run(pa, active, pb, left);
    await db
      .prepare("INSERT INTO enrollments (student_id, class_id, status) VALUES (?, ?, 'active')")
      .run(active, cls);
    await db
      .prepare("INSERT INTO enrollments (student_id, class_id, status) VALUES (?, ?, 'inactive')")
      .run(left, cls);

    const r = await svc.createAnnouncement(centerId, { title: 'Nghỉ lễ', body: 'Nghỉ 2/9', class_id: cls });
    assert.equal(r.recipient_count, 1);
    assert.equal(await svc.unreadCount({ type: 'parent', id: pa }), 1);
    assert.equal(await svc.unreadCount({ type: 'parent', id: pb }), 0);

    const all = await svc.createAnnouncement(centerId, { title: 'Chung', body: 'Toàn trung tâm' });
    assert.equal(all.recipient_count, 2);
    await assert.rejects(svc.createAnnouncement(centerId, { title: 'x', body: 'y', class_id: foreign }), {
      code: 'INVALID_CLASS',
    });
    assert.equal((await svc.listAnnouncements(centerId)).pagination.total, 2);
  });
});
