/**
 * Lịch + dạy thay + dời buổi (DB thật, migration v26): giờ thực theo lịch tuần, scope 'own' của giáo viên
 * dạy thay, chặn trùng giáo viên, dời buổi không bị job sinh lịch hồi sinh, đổi GV lớp giữ buổi dạy thay.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { toISODate, addDays, extendActiveClassSessions } from '../../db';
import * as classService from '../classes/classes.service';
import * as sessionService from './sessions.service';

const ALL_DAYS = [2, 3, 4, 5, 6, 7, 8].map((day) => ({ day, start: '18:00', end: '19:30' }));
const d = (n: number) => toISODate(addDays(new Date(), n));

let centerId = 0;
let t1 = 0;
let t2 = 0;
let ctx: { centerId: number; role: string; teacherId: null };
const own = (teacherId: number) => ({ centerId, role: 'teacher', teacherId, ownOnly: true });

async function insertTeacher(name: string): Promise<number> {
  return Number(
    (await db.prepare('INSERT INTO teachers (name, center_id) VALUES (?, ?)').run(name, centerId))
      .lastInsertRowid
  );
}

async function makeClass(name: string, teacherId: number, schedule = ALL_DAYS): Promise<number> {
  const cls = (await classService.createClass(ctx, {
    name,
    teacher_id: teacherId,
    schedule,
    start_date: d(0),
    end_date: d(10),
    tuition_fee: 0,
    max_students: 10,
  })) as { id: number };
  return cls.id;
}

async function sessionOn(classId: number, date: string) {
  return (await db.prepare('SELECT * FROM sessions WHERE class_id = ? AND date = ?').get(classId, date)) as {
    id: number;
    status: string;
    teacher_id: number | null;
  };
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: { code?: string }) => e.code === code);
}

before(setupTestDb);
after(teardownTestDb);

beforeEach(async () => {
  await resetTestDb();
  centerId = Number((await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run()).lastInsertRowid);
  ctx = { centerId, role: 'admin', teacherId: null };
  t1 = await insertTeacher('GV 1');
  t2 = await insertTeacher('GV 2');
});

describe('lịch buổi học', () => {
  it('giờ thực lấy từ lịch tuần; khoảng > 62 ngày bị từ chối', async () => {
    const a = await makeClass('A', t1);
    const items = await sessionService.listCalendar(ctx, { from: d(1), to: d(2) });
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => [i.class_id, i.start, i.end, i.teacher_id, i.substitute]),
      [
        [a, '18:00', '19:30', t1, false],
        [a, '18:00', '19:30', t1, false],
      ]
    );
    await rejects(sessionService.listCalendar(ctx, { from: d(0), to: d(70) }), 'RANGE_TOO_LARGE');
  });

  it('dạy thay: GV thay thấy buổi trong lịch own; đổi GV lớp không ghi đè buổi dạy thay', async () => {
    const a = await makeClass('A', t1);
    const s = await sessionOn(a, d(2));
    assert.equal((await sessionService.listCalendar(own(t2), { from: d(0), to: d(10) })).length, 0);

    const item = await sessionService.updateSessionDetails(ctx, s.id, { teacher_id: t2 });
    assert.equal(item.teacher_id, t2);
    assert.equal(item.substitute, true);
    const mine = await sessionService.listCalendar(own(t2), { from: d(0), to: d(10) });
    assert.deepEqual(
      mine.map((i) => i.id),
      [s.id]
    );

    const t3 = await insertTeacher('GV 3');
    await classService.updateClass(ctx, a, {
      name: 'A',
      teacher_id: t3,
      schedule: ALL_DAYS,
      start_date: d(0),
      end_date: d(10),
      tuition_fee: 0,
      max_students: 10,
    });
    assert.equal((await sessionOn(a, d(2))).teacher_id, t2, 'buổi dạy thay giữ nguyên');
    assert.equal((await sessionOn(a, d(3))).teacher_id, t3, 'buổi thường theo GV mới');
  });

  it('chặn trùng giáo viên cùng giờ; giờ riêng hết giao nhau thì cho phép', async () => {
    const a = await makeClass('A', t1);
    await makeClass(
      'B',
      t2,
      [2, 3, 4, 5, 6, 7, 8].map((day) => ({ day, start: '19:00', end: '20:30' }))
    );
    const s = await sessionOn(a, d(2));
    await rejects(sessionService.updateSessionDetails(ctx, s.id, { teacher_id: t2 }), 'TEACHER_CONFLICT');
    assert.equal((await sessionOn(a, d(2))).teacher_id, t1, 'rollback khi trùng');

    const ok = await sessionService.updateSessionDetails(ctx, s.id, {
      teacher_id: t2,
      start_time: '16:00',
      end_time: '17:30',
    });
    assert.deepEqual([ok.start, ok.end, ok.teacher_id], ['16:00', '17:30', t2]);
    await rejects(
      sessionService.updateSessionDetails(ctx, s.id, { start_time: '18:00', end_time: '17:00' }),
      'BAD_REQUEST'
    );
  });

  it('dời buổi: buổi gốc hủy, buổi mới giữ giờ cũ + trỏ về gốc, job sinh lịch không tạo lại ngày cũ', async () => {
    const a = await makeClass('A', t1, [{ day: 2, start: '18:00', end: '19:30' }]);
    // ngày có buổi theo lịch (thứ Hai) trong 10 ngày tới
    const [orig] = await sessionService.listCalendar(ctx, { from: d(1), to: d(8) });
    const plus = (n: number) => toISODate(addDays(new Date(`${orig.date}T00:00:00`), n));
    const moved = await sessionService.rescheduleSession(ctx, orig.id, { date: plus(1) });
    assert.equal(moved.rescheduled_from, orig.id);
    assert.deepEqual([moved.date, moved.start, moved.end], [plus(1), '18:00', '19:30']);
    assert.equal((await sessionOn(a, orig.date)).status, 'cancelled');

    await extendActiveClassSessions();
    assert.equal((await sessionOn(a, orig.date)).status, 'cancelled', 'không hồi sinh ngày cũ');

    // dời vào ngày lớp đã có buổi -> 409; buổi đã điểm danh -> 409
    await sessionService.createSession(ctx, { class_id: a, date: plus(2) });
    await rejects(sessionService.rescheduleSession(ctx, moved.id, { date: plus(2) }), 'SESSION_EXISTS');
    const sid = Number(
      (await db.prepare("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HS', ?)").run(centerId))
        .lastInsertRowid
    );
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(moved.id, sid);
    await rejects(
      sessionService.rescheduleSession(ctx, moved.id, { date: plus(3) }),
      'SESSION_HAS_ATTENDANCE'
    );
  });
});
