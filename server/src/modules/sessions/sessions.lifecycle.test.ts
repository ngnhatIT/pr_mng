/**
 * Vòng đời buổi học (DB thật): sinh khi tạo/sửa lớp (không sinh lúc GET), hủy mềm không bị hồi sinh,
 * đổi lịch dọn buổi tương lai, đổi giáo viên không chuyển lương quá khứ, giới hạn ngày điểm danh,
 * payroll chỉ tính buổi đã diễn ra có học viên có mặt/check-in.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { toISODate, addDays } from '../../db/date-utils';
import { AppError } from '../../shared/errors';
import * as classService from '../classes/classes.service';
import * as sessionService from './sessions.service';
import { calcPayroll } from '../payroll/payroll.service';

const ALL_DAYS = [2, 3, 4, 5, 6, 7, 8].map((day) => ({ day, start: '18:00', end: '19:30' }));
const d = (n: number) => toISODate(addDays(new Date(), n));

let centerId = 0;
let t1 = 0;
let t2 = 0;
let studentId = 0;
let ctx: { centerId: number; role: string; teacherId: null };

async function count(sql: string, ...p: unknown[]): Promise<number> {
  return Number(((await db.prepare(sql).get(...p)) as { c: number | string }).c);
}

async function sessionAt(classId: number, date: string) {
  return (await db.prepare('SELECT * FROM sessions WHERE class_id = ? AND date = ?').get(classId, date)) as
    { id: number; status: string; teacher_id: number | null } | undefined;
}

async function makeClass(extra: Record<string, unknown> = {}): Promise<number> {
  const cls = (await classService.createClass(ctx, {
    name: 'Lớp A',
    teacher_id: t1,
    schedule: ALL_DAYS,
    start_date: d(-14),
    end_date: d(14),
    tuition_fee: 0,
    max_students: 10,
    ...extra,
  })) as { id: number };
  await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(studentId, cls.id);
  return cls.id;
}

before(async () => {
  await setupTestDb();
});
after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  centerId = Number((await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run()).lastInsertRowid);
  ctx = { centerId, role: 'admin', teacherId: null };
  t1 = Number(
    (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV 1', ?)").run(centerId))
      .lastInsertRowid
  );
  t2 = Number(
    (await db.prepare("INSERT INTO teachers (name, center_id) VALUES ('GV 2', ?)").run(centerId))
      .lastInsertRowid
  );
  studentId = Number(
    (await db.prepare("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HS', ?)").run(centerId))
      .lastInsertRowid
  );
});

describe('sessions lifecycle', () => {
  it('createClass sinh đủ buổi theo lịch, gán teacher_id = GV lớp', async () => {
    const classId = await makeClass();
    assert.equal(await count('SELECT COUNT(*) as c FROM sessions WHERE class_id = ?', classId), 29);
    assert.equal(await count('SELECT COUNT(*) as c FROM sessions WHERE teacher_id = ?', t1), 29);
  });

  it('GET danh sách buổi KHÔNG insert buổi nào', async () => {
    const classId = Number(
      (
        await db
          .prepare("INSERT INTO classes (name, center_id, teacher_id, schedule) VALUES ('L', ?, ?, ?)")
          .run(centerId, t1, JSON.stringify(ALL_DAYS))
      ).lastInsertRowid
    );
    const rows = await sessionService.listClassSessions(ctx, classId);
    assert.equal(rows.length, 0);
    assert.equal(await count('SELECT COUNT(*) as c FROM sessions WHERE class_id = ?', classId), 0);
  });

  it('danh sách buổi không trả checkin_code', async () => {
    const classId = await makeClass();
    const s = await sessionAt(classId, d(0));
    await sessionService.generateCheckinCode(ctx, s!.id);
    const rows = (await sessionService.listClassSessions(ctx, classId)) as Record<string, unknown>[];
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !('checkin_code' in r) && !('checkin_date' in r)));
  });

  it('hủy buổi = soft-cancel, sửa lớp không hồi sinh, danh sách ẩn buổi đã hủy', async () => {
    const classId = await makeClass();
    const s = await sessionAt(classId, d(3));
    await sessionService.deleteSession(ctx, s!.id);
    await classService.updateClass(ctx, classId, {
      name: 'Lớp A',
      teacher_id: t1,
      schedule: ALL_DAYS,
      start_date: d(-14),
      end_date: d(14),
      tuition_fee: 0,
      max_students: 10,
    });
    assert.equal((await sessionAt(classId, d(3)))?.status, 'cancelled');
    const rows = (await sessionService.listClassSessions(ctx, classId)) as { date: string }[];
    assert.ok(!rows.some((r) => r.date === d(3)));
    // Tạo thủ công lại đúng ngày đó -> khôi phục
    await sessionService.createSession(ctx, { class_id: classId, date: d(3) });
    assert.equal((await sessionAt(classId, d(3)))?.status, 'scheduled');
  });

  it('đổi lịch: xóa buổi tương lai thứ bị bỏ, giữ quá khứ và buổi đã điểm danh', async () => {
    const classId = await makeClass();
    const keepPast = await sessionAt(classId, d(-2));
    const attended = await sessionAt(classId, d(0));
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(attended!.id, studentId);
    const onlyDay = [{ day: 2, start: '18:00', end: '19:30' }]; // chỉ còn Thứ Hai
    await classService.updateClass(ctx, classId, {
      name: 'Lớp A',
      teacher_id: t1,
      schedule: onlyDay,
      start_date: d(-14),
      end_date: d(14),
      tuition_fee: 0,
      max_students: 10,
    });
    assert.ok(await sessionAt(classId, d(-2)), 'buổi quá khứ giữ nguyên');
    assert.equal((await sessionAt(classId, d(-2)))?.id, keepPast!.id);
    assert.ok(await sessionAt(classId, d(0)), 'buổi đã điểm danh giữ nguyên');
    const future = (await db
      .prepare('SELECT date FROM sessions WHERE class_id = ? AND date > ?')
      .all(classId, d(0))) as { date: string }[];
    assert.ok(future.length >= 2 && future.length <= 3);
    for (const f of future)
      assert.equal(new Date(`${f.date}T12:00:00Z`).getUTCDay(), 1, `${f.date} phải là Thứ Hai`);
  });

  it('đổi giáo viên: buổi quá khứ giữ GV cũ (lương không bị chuyển), buổi tương lai sang GV mới', async () => {
    const classId = await makeClass();
    const past = await sessionAt(classId, d(-1));
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(past!.id, studentId);
    await classService.updateClass(ctx, classId, {
      name: 'Lớp A',
      teacher_id: t2,
      schedule: ALL_DAYS,
      start_date: d(-14),
      end_date: d(14),
      tuition_fee: 0,
      max_students: 10,
    });
    assert.equal((await sessionAt(classId, d(-1)))?.teacher_id, t1);
    assert.equal((await sessionAt(classId, d(2)))?.teacher_id, t2);
    const month = d(-1).slice(0, 7);
    assert.equal((await calcPayroll(t1, month)).sessions, 1);
    assert.equal((await calcPayroll(t2, month)).sessions, 0);
  });

  it('payroll bỏ qua buổi toàn vắng, buổi tương lai và buổi đã hủy', async () => {
    const classId = await makeClass();
    const absentOnly = await sessionAt(classId, d(-1));
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'absent')")
      .run(absentOnly!.id, studentId);
    const future = await sessionAt(classId, d(1));
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(future!.id, studentId);
    assert.equal((await calcPayroll(t1, d(-1).slice(0, 7))).sessions, 0);
    assert.equal((await calcPayroll(t1, d(1).slice(0, 7))).sessions, 0);
  });

  it('điểm danh: chặn buổi tương lai; scope own chặn buổi cũ hơn 7 ngày', async () => {
    const classId = await makeClass();
    const future = await sessionAt(classId, d(1));
    await assert.rejects(
      () => sessionService.saveAttendance(ctx, future!.id, [{ student_id: studentId, status: 'present' }]),
      (e: unknown) => e instanceof AppError && e.statusCode === 400
    );
    const old = await sessionAt(classId, d(-10));
    const own = { centerId, role: 'teacher', teacherId: t1, ownOnly: true };
    await assert.rejects(
      () => sessionService.saveAttendance(own, old!.id, [{ student_id: studentId, status: 'present' }]),
      (e: unknown) => e instanceof AppError && e.statusCode === 400
    );
    // Giáo vụ (scope center) vẫn sửa được buổi cũ; giáo viên điểm danh được buổi hôm nay
    const r1 = await sessionService.saveAttendance(ctx, old!.id, [
      { student_id: studentId, status: 'present' },
    ]);
    assert.equal(r1.saved, 1);
    const today = await sessionAt(classId, d(0));
    const r2 = await sessionService.saveAttendance(own, today!.id, [
      { student_id: studentId, status: 'late' },
    ]);
    assert.equal(r2.saved, 1);
  });

  it('scope own chưa gắn teacher_id không thấy lớp/buổi nào', async () => {
    const classId = await makeClass();
    await assert.rejects(
      () =>
        sessionService.listClassSessions(
          { centerId, role: 'custom', teacherId: null, ownOnly: true },
          classId
        ),
      (e: unknown) => e instanceof AppError && e.statusCode === 404
    );
  });

  it('xóa lớp đã có điểm danh bị chặn', async () => {
    const classId = await makeClass();
    const s = await sessionAt(classId, d(-1));
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(s!.id, studentId);
    await assert.rejects(
      () => classService.deleteClass(ctx, classId),
      (e: unknown) => e instanceof AppError && e.statusCode === 400
    );
    assert.equal(await count('SELECT COUNT(*) as c FROM attendance'), 1);
  });

  it('trùng lịch: lớp đã kết thúc không chặn phòng/GV; giờ ngược bị từ chối', async () => {
    await makeClass({ start_date: d(-60), end_date: d(-30) }); // lớp cũ đã kết thúc, vẫn 'active'
    const ok = (await classService.createClass(ctx, {
      name: 'Lớp B',
      teacher_id: t1,
      schedule: ALL_DAYS,
      start_date: d(0),
      end_date: d(10),
      tuition_fee: 0,
    })) as { id: number };
    assert.ok(ok.id > 0);
    await assert.rejects(
      () =>
        classService.createClass(ctx, {
          name: 'Lớp C',
          teacher_id: t1,
          schedule: ALL_DAYS,
          start_date: d(5),
          tuition_fee: 0,
        }),
      /trùng lịch/
    );
    assert.throws(
      () => classService.parseSchedule([{ day: 2, start: '20:00', end: '18:00' }]),
      /trước giờ kết thúc/
    );
    assert.throws(() => classService.parseSchedule([{ day: 2, start: '99:99', end: '23:00' }]), /HH:MM/);
  });
});
