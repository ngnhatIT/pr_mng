/**
 * PUT /payroll/rules (setSalaryRule) + O-1 đơn giá theo ngày hiệu lực:
 * - GV trung tâm khác -> 404; số tiền âm/lẻ, ngày hiệu lực ngoài khoảng -> 400; ghi audit
 * - đổi đơn giá giữa tháng: buổi trước ngày hiệu lực giữ giá cũ, tháng cũ không đổi
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { AppError } from '../../shared/errors';
import { todayVN } from '../../shared/vnTime';
import {
  setSalaryRule,
  calcPayroll,
  calcPayrollBulk,
  firstDayOfPrevMonth,
  setPayrollClosed,
} from './payroll.service';
import { saveAttendance, deleteSession } from '../sessions/sessions.service';

const id = async (sql: string, ...p: unknown[]) => Number((await db.prepare(sql).run(...p)).lastInsertRowid);
const is = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code;
const actor = { id: null, name: 'Admin', role: 'admin' };

let centerA = 0;
let teacher = 0;

describe('payroll rules (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    centerA = await id("INSERT INTO centers (name) VALUES ('TT A')");
    teacher = await id("INSERT INTO teachers (name, center_id) VALUES ('GV', ?)", centerA);
  });
  after(async () => {
    await teardownTestDb();
  });

  it('GV trung tâm khác -> 404, không ghi gì', async () => {
    const centerB = await id("INSERT INTO centers (name) VALUES ('TT B')");
    await assert.rejects(
      setSalaryRule(centerB, { teacher_id: teacher, per_session_amount: 100000 }, actor),
      is(404)
    );
    assert.equal(await db.prepare('SELECT 1 FROM salary_rules WHERE teacher_id = ?').get(teacher), undefined);
  });

  it('số tiền âm / lẻ / ngày hiệu lực tương lai hoặc quá xa -> 400', async () => {
    for (const per_session_amount of [-1, 1000.5, 100000001]) {
      await assert.rejects(
        setSalaryRule(centerA, { teacher_id: teacher, per_session_amount }, actor),
        is(400)
      );
    }
    for (const effective_from of ['2999-01-01', '2000-01-01']) {
      await assert.rejects(
        setSalaryRule(centerA, { teacher_id: teacher, per_session_amount: 1, effective_from }, actor),
        is(400)
      );
    }
  });

  it('ghi salary_rules + lịch sử + audit (center của GV)', async () => {
    await setSalaryRule(null, { teacher_id: teacher, per_session_amount: 150000 }, actor); // superadmin
    const sr = (await db
      .prepare('SELECT per_session_amount FROM salary_rules WHERE teacher_id = ?')
      .get(teacher)) as {
      per_session_amount: number;
    };
    assert.equal(Number(sr.per_session_amount), 150000);
    const log = (await db
      .prepare("SELECT center_id, meta FROM audit_logs WHERE entity = 'salary_rules' AND entity_id = ?")
      .get(teacher)) as { center_id: number; meta: string };
    assert.equal(log.center_id, centerA);
    assert.equal(JSON.parse(log.meta).new_amount, 150000);
  });

  it('O-1: đổi giá giữa tháng chỉ áp từ ngày hiệu lực; tháng cũ giữ giá cũ', async () => {
    const prev = firstDayOfPrevMonth(todayVN()); // YYYY-MM-01 tháng trước
    const older = firstDayOfPrevMonth(prev);
    const cls = await id(
      "INSERT INTO classes (name, center_id, teacher_id) VALUES ('L', ?, ?)",
      centerA,
      teacher
    );
    for (const date of [`${older.slice(0, 7)}-10`, `${prev.slice(0, 7)}-01`, `${prev.slice(0, 7)}-20`]) {
      const s = await id(
        'INSERT INTO sessions (class_id, date, teacher_id) VALUES (?, ?, ?)',
        cls,
        date,
        teacher
      );
      await db.prepare('INSERT INTO teacher_checkins (session_id, teacher_id) VALUES (?, ?)').run(s, teacher);
    }
    // Đơn giá cũ có từ trước khi có lịch sử
    await db
      .prepare('INSERT INTO salary_rules (teacher_id, per_session_amount) VALUES (?, 80000)')
      .run(teacher);
    await setSalaryRule(
      centerA,
      { teacher_id: teacher, per_session_amount: 100000, effective_from: prev },
      actor
    );
    await setSalaryRule(
      centerA,
      { teacher_id: teacher, per_session_amount: 150000, effective_from: `${prev.slice(0, 7)}-15` },
      actor
    );
    const p = await calcPayroll(teacher, prev.slice(0, 7));
    assert.deepEqual(p, { sessions: 2, per_session: 150000, total: 250000 });
    assert.equal((await calcPayroll(teacher, older.slice(0, 7))).total, 80000, 'tháng cũ không đổi');
    const bulk = await calcPayrollBulk(centerA, prev.slice(0, 7));
    assert.equal(bulk.find((r) => r.teacher_id === teacher)?.total, 250000);
  });
  it('J-A8: chốt tháng -> đổi đơn giá lùi ngày / điểm danh / hủy buổi tháng đó 409; mở lại thì sửa được', async () => {
    const prevStart = firstDayOfPrevMonth(todayVN());
    const prevMonth = prevStart.slice(0, 7);
    await assert.rejects(setPayrollClosed(centerA, todayVN().slice(0, 7), true, actor), is(400));
    await setPayrollClosed(centerA, prevMonth, true, actor);
    await setPayrollClosed(centerA, prevMonth, true, actor); // idempotent
    await assert.rejects(
      setSalaryRule(
        centerA,
        { teacher_id: teacher, per_session_amount: 1, effective_from: prevStart },
        actor
      ),
      is(409)
    );
    await setSalaryRule(centerA, { teacher_id: teacher, per_session_amount: 1 }, actor); // từ hôm nay: ok

    const cls = await id(
      "INSERT INTO classes (name, center_id, teacher_id) VALUES ('L', ?, ?)",
      centerA,
      teacher
    );
    const st = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HV', ?)", centerA);
    await db.prepare('INSERT INTO enrollments (student_id, class_id) VALUES (?, ?)').run(st, cls);
    const sess = await id(
      'INSERT INTO sessions (class_id, date, teacher_id) VALUES (?, ?, ?)',
      cls,
      prevStart,
      teacher
    );
    const ctx = { centerId: centerA, role: 'admin', teacherId: null };
    await assert.rejects(saveAttendance(ctx, sess, [{ student_id: st, status: 'present' }]), is(409));
    await assert.rejects(deleteSession(ctx, sess), is(409));

    await setPayrollClosed(centerA, prevMonth, false, actor);
    assert.equal((await saveAttendance(ctx, sess, [{ student_id: st, status: 'present' }])).saved, 1);
    const audits = (await db
      .prepare("SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity = 'payroll_closures'")
      .get()) as { c: number };
    assert.equal(audits.c, 2, 'chốt + mở lại đều có audit (lần chốt trùng không ghi)');
  });

  it('N-1: đơn giá ĐẦU TIÊN không áp ngược vào tháng cũ (kể cả tháng đã chốt)', async () => {
    const prevStart = firstDayOfPrevMonth(todayVN());
    const prevMonth = prevStart.slice(0, 7);
    const cls = await id(
      "INSERT INTO classes (name, center_id, teacher_id) VALUES ('L', ?, ?)",
      centerA,
      teacher
    );
    const s = await id(
      'INSERT INTO sessions (class_id, date, teacher_id) VALUES (?, ?, ?)',
      cls,
      prevStart,
      teacher
    );
    await db.prepare('INSERT INTO teacher_checkins (session_id, teacher_id) VALUES (?, ?)').run(s, teacher);
    assert.deepEqual(await calcPayroll(teacher, prevMonth), { sessions: 1, per_session: 0, total: 0 });
    await setPayrollClosed(centerA, prevMonth, true, actor);
    await setSalaryRule(centerA, { teacher_id: teacher, per_session_amount: 180000 }, actor); // từ hôm nay
    assert.equal((await calcPayroll(teacher, prevMonth)).total, 0, 'tháng đã chốt không đổi');
    // Mở lại tháng: tính lại từ dữ liệu vẫn 0 (mốc 1970 = 0), không phải 180000
    await setPayrollClosed(centerA, prevMonth, false, actor);
    assert.equal((await calcPayrollBulk(centerA, prevMonth)).find((r) => r.teacher_id === teacher)?.total, 0);
  });

  it('N-1: tháng đã chốt trả bảng lương chụp lúc chốt — sửa dữ liệu sau đó (xóa HV/điểm danh) không đổi được', async () => {
    const prevStart = firstDayOfPrevMonth(todayVN());
    const prevMonth = prevStart.slice(0, 7);
    await setSalaryRule(
      centerA,
      { teacher_id: teacher, per_session_amount: 100000, effective_from: prevStart },
      actor
    );
    const cls = await id(
      "INSERT INTO classes (name, center_id, teacher_id) VALUES ('L', ?, ?)",
      centerA,
      teacher
    );
    const st = await id("INSERT INTO students (code, name, center_id) VALUES ('HV1', 'HV', ?)", centerA);
    const s = await id(
      'INSERT INTO sessions (class_id, date, teacher_id) VALUES (?, ?, ?)',
      cls,
      prevStart,
      teacher
    );
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(s, st);
    await setPayrollClosed(centerA, prevMonth, true, actor);
    const frozen = { sessions: 1, per_session: 100000, total: 100000 };
    // N-6: xóa học viên xóa luôn điểm danh của tháng đã chốt (buổi không còn ai có mặt)
    await db.prepare('DELETE FROM attendance WHERE student_id = ?').run(st);
    assert.deepEqual(await calcPayroll(teacher, prevMonth), frozen);
    const bulk = await calcPayrollBulk(null, prevMonth); // superadmin: ghép bản chốt + trung tâm chưa chốt
    assert.deepEqual(
      bulk.find((r) => r.teacher_id === teacher),
      { teacher_id: teacher, teacher_name: 'GV', ...frozen }
    );
    // Bản chốt trước v25 (snapshot NULL) -> chụp lần đọc đầu tiên rồi giữ nguyên
    await db.prepare('UPDATE payroll_closures SET snapshot = NULL').run();
    assert.equal((await calcPayroll(teacher, prevMonth)).total, 0);
    await db
      .prepare("INSERT INTO attendance (session_id, student_id, status) VALUES (?, ?, 'present')")
      .run(s, st);
    assert.equal((await calcPayroll(teacher, prevMonth)).total, 0, 'đã chụp ở lần đọc trước');
  });
});
