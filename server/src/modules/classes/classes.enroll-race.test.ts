/**
 * Race test cho enrollStudent (classes.service.ts) — KHÔNG cần PostgreSQL.
 * Mock db layer bằng mock-db.ts; transaction được serialize để mô phỏng
 * SELECT ... FOR UPDATE trên PG thật (tx sau thấy commit của tx trước).
 *
 * Case P0 (audit K2b): lớp còn đúng 1 chỗ, 2 request ghi danh đồng thời ->
 * đúng 1 thành công, 1 throw lỗi "đủ sĩ số", sĩ số cuối không vượt max.
 */
// PHẢI đặt trước mọi import db — config/env fail-fast nếu thiếu DATABASE_URL
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock:mock@localhost:5432/mockdb';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import type { RunResult } from '../../db/pg-compat';
import { enrollStudent } from './classes.service';

const CLASS_ID = 5;
const MAX_STUDENTS = 2;
// centerId null = superadmin: getScopedClass không thêm điều kiện center
const CTX = { centerId: null, role: 'admin', teacherId: null };

interface Enrollment {
  student_id: number;
  class_id: number;
  status: string;
}

let enrollments: Enrollment[];
let restore: (() => void) | null = null;

function okRun(): RunResult {
  return { changes: 1, lastInsertRowid: undefined };
}

/** Lớp có MAX_STUDENTS=2, đã có 1 học viên active -> còn đúng 1 chỗ. */
function setupState(): void {
  enrollments = [{ student_id: 101, class_id: CLASS_ID, status: 'active' }];
  const routes: MockRoute[] = [
    {
      match: 'FROM classes c WHERE c.id = ?',
      get: () => ({ id: CLASS_ID, name: 'Lop 1', center_id: 1, max_students: MAX_STUDENTS }),
    },
    { match: 'FROM students WHERE id = ?', get: (p) => ({ id: Number(p[0]), center_id: 1 }) },
    {
      match: 'FROM classes WHERE id = ? FOR UPDATE',
      get: () => ({ max_students: MAX_STUDENTS }),
    },
    {
      match: "FROM enrollments WHERE class_id = ? AND status = 'active'",
      get: (p) => ({
        c: enrollments.filter((e) => e.class_id === Number(p[0]) && e.status === 'active').length,
      }),
    },
    // Route dài hơn đặt trước (chuỗi ngắn là tiền tố của chuỗi dài)
    {
      match: 'FROM enrollments WHERE student_id = ? AND class_id = ? AND status = ?',
      get: (p) =>
        enrollments.some(
          (e) => e.student_id === Number(p[0]) && e.class_id === Number(p[1]) && e.status === String(p[2])
        )
          ? { '1': 1 }
          : undefined,
    },
    {
      match: 'FROM enrollments WHERE student_id = ? AND class_id = ?',
      get: (p) => enrollments.find((e) => e.student_id === Number(p[0]) && e.class_id === Number(p[1])),
    },
    {
      match: "UPDATE enrollments SET status = 'active'",
      run: (p) => {
        const e = enrollments.find((x) => x.student_id === Number(p[0]) && x.class_id === Number(p[1]));
        if (e) e.status = 'active';
        return okRun();
      },
    },
    {
      match: 'INSERT INTO enrollments',
      run: (p) => {
        enrollments.push({ student_id: Number(p[0]), class_id: Number(p[1]), status: 'active' });
        return okRun();
      },
    },
  ];
  if (restore) restore();
  restore = installMockDb(routes);
}

function activeCount(): number {
  return enrollments.filter((e) => e.class_id === CLASS_ID && e.status === 'active').length;
}

beforeEach(() => setupState());
after(() => restore?.());

describe('enrollStudent race', () => {
  it('còn 1 chỗ, 2 ghi danh đồng thời -> 1 thành công, 1 báo đủ sĩ số', async () => {
    const results = await Promise.allSettled([
      enrollStudent(CTX, CLASS_ID, 102),
      enrollStudent(CTX, CLASS_ID, 103),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    assert.match(String((failed[0] as PromiseRejectedResult).reason?.message || ''), /đủ sĩ số/);
    assert.equal(activeCount(), MAX_STUDENTS); // sĩ số cuối không vượt max
  });
});
