/**
 * Unit test cho saveAttendance (sessions.service.ts) — KHÔNG cần PostgreSQL.
 * Mock db layer bằng mock-db.ts.
 *
 * Bao phủ 3 case P1 (audit K2c):
 * 1. Học viên không thuộc lớp (không có enrollment active) bị loại khỏi danh sách chấm.
 * 2. Chấm 2 lần cùng buổi -> upsert ghi đè (không tạo 2 bản ghi).
 * 3. Status không nằm trong whitelist (present/absent/late) bị lọc.
 * (Không dùng status 'absent' trong test để tránh kích hoạt notifyParents gửi ZNS thật.)
 */
// PHẢI đặt trước mọi import db — config/env fail-fast nếu thiếu DATABASE_URL
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock:mock@localhost:5432/mockdb';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import type { RunResult } from '../../db/pg-compat';
import { saveAttendance } from './sessions.service';

const SESSION_ID = 7;
const CLASS_ID = 5;
const CTX = { centerId: 1, role: 'staff', teacherId: null };

interface AttRow {
  session_id: number;
  student_id: number;
  status: string;
  note: string | null;
}

let attendance: AttRow[];
let enrolledIds: number[];
let restore: (() => void) | null = null;

function okRun(): RunResult {
  return { changes: 1, lastInsertRowid: undefined };
}

/** Buổi học của lớp 5 (center 1); lớp có 2 học viên enrolled: 101, 102. */
function setupState(): void {
  attendance = [];
  enrolledIds = [101, 102];
  const routes: MockRoute[] = [
    {
      match: 'FROM sessions s JOIN classes c',
      get: () => ({
        session_id: SESSION_ID,
        class_id: CLASS_ID,
        date: '2026-10-10',
        topic: null,
        center_id: 1,
        teacher_id: null,
        class_name: 'Lop 1',
      }),
    },
    // J-A8: tháng lương chưa chốt
    { match: 'FROM payroll_closures', get: () => undefined },
    {
      match: "FROM enrollments WHERE class_id = ? AND status = 'active'",
      all: () => enrolledIds.map((id) => ({ student_id: id })),
    },
    {
      match: 'FROM attendance WHERE session_id = ?',
      all: (p) =>
        attendance
          .filter((a) => a.session_id === Number(p[0]))
          .map((a) => ({ student_id: a.student_id, status: a.status })),
    },
    {
      match: 'INSERT INTO attendance',
      run: (p) => {
        const sid = Number(p[0]);
        const stid = Number(p[1]);
        const status = String(p[2]);
        const note = p[3] == null ? null : String(p[3]);
        const ex = attendance.find((a) => a.session_id === sid && a.student_id === stid);
        if (ex) {
          ex.status = status; // ON CONFLICT DO UPDATE — ghi đè, không tạo bản ghi mới
          ex.note = note;
        } else {
          attendance.push({ session_id: sid, student_id: stid, status, note });
        }
        return okRun();
      },
    },
    { match: 'FROM students WHERE id = ?', get: (p) => ({ name: `HV ${p[0]}` }) },
  ];
  if (restore) restore();
  restore = installMockDb(routes);
}

function rowsFor(sessionId: number): AttRow[] {
  return attendance.filter((a) => a.session_id === sessionId);
}

beforeEach(() => setupState());
after(() => restore?.());

describe('saveAttendance', () => {
  it('(1) học viên không thuộc lớp bị loại khỏi danh sách chấm', async () => {
    const r = await saveAttendance(CTX, SESSION_ID, [
      { student_id: 101, status: 'present' },
      { student_id: 999, status: 'present' }, // không enrolled -> bị loại
    ]);
    assert.equal(r.saved, 1);
    assert.equal(r.date, '2026-10-10');
    const rows = rowsFor(SESSION_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].student_id, 101);
  });

  it('(2) chấm 2 lần cùng buổi -> upsert ghi đè, không tạo bản ghi trùng', async () => {
    await saveAttendance(CTX, SESSION_ID, [{ student_id: 101, status: 'present' }]);
    const r = await saveAttendance(CTX, SESSION_ID, [
      { student_id: 101, status: 'late' }, // đổi trạng thái
      { student_id: 102, status: 'present' },
    ]);
    assert.equal(r.saved, 2);
    const rows = rowsFor(SESSION_ID);
    assert.equal(rows.length, 2); // vẫn 2 bản ghi, không phải 3
    assert.equal(rows.find((x) => x.student_id === 101)?.status, 'late'); // đã ghi đè
  });

  it('(3) status không hợp lệ bị lọc', async () => {
    const r = await saveAttendance(CTX, SESSION_ID, [
      { student_id: 101, status: 'present' },
      { student_id: 102, status: 'vắng mặt' }, // không trong whitelist -> bị lọc
    ]);
    assert.equal(r.saved, 1);
    const rows = rowsFor(SESSION_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].student_id, 101);
  });
});
