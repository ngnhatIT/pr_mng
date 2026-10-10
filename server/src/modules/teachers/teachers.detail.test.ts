/**
 * Test getTeacherDetail (teachers.service.ts) và filter ?teacher_id= của listClasses —
 * KHÔNG cần PostgreSQL, mock db layer bằng mock-db.ts.
 *
 * - getTeacherDetail trả đúng giáo viên kèm class_count
 * - 404 khi không tồn tại hoặc khác center
 * - listClasses({ teacherId }) chỉ trả lớp của giáo viên đó (param được truyền xuống SQL)
 * - không truyền teacherId -> behavior cũ, đủ danh sách
 */
// PHẢI đặt trước mọi import db — config/env fail-fast nếu thiếu DATABASE_URL
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock:mock@localhost:5432/mockdb';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import { getTeacherDetail } from './teachers.service';
import { listClasses } from '../classes/classes.service';

const CTX = { centerId: null, role: 'admin', teacherId: null };

interface MockTeacher {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  center_id: number;
  class_count: number;
}

const TEACHER: MockTeacher = {
  id: 7,
  name: 'Nguyễn Văn A',
  phone: '0901112222',
  email: 'a@example.com',
  subject: 'Tiếng Anh',
  center_id: 3,
  class_count: 2,
};

interface MockClass {
  id: number;
  name: string;
  teacher_id: number;
  teacher_name: string | null;
  room_name: string | null;
  student_count: number;
}

const CLASSES: MockClass[] = [
  { id: 1, name: 'IELTS A', teacher_id: 7, teacher_name: 'Nguyễn Văn A', room_name: null, student_count: 5 },
  {
    id: 2,
    name: 'Giao tiếp B',
    teacher_id: 7,
    teacher_name: 'Nguyễn Văn A',
    room_name: null,
    student_count: 3,
  },
  { id: 3, name: 'IELTS C', teacher_id: 9, teacher_name: 'Trần Thị B', room_name: null, student_count: 8 },
];

let teacherRow: MockTeacher | undefined = TEACHER;
let restore: (() => void) | null = null;

function setupMock(): void {
  teacherRow = TEACHER;
  const routes: MockRoute[] = [
    {
      match: 'FROM teachers t WHERE t.id = ?',
      get: (p) => {
        // centerId !== null -> SQL có AND t.center_id = ?, params = [id, centerId]
        if (p.length > 1 && teacherRow && teacherRow.center_id !== p[1]) return undefined;
        return teacherRow;
      },
    },
    {
      match: 'SELECT COUNT(*) as c FROM classes c',
      get: (p) => {
        // COUNT: có filter -> params = [teacherId], không filter -> []
        const tid = p.length > 0 ? (p[0] as number) : undefined;
        const rows = tid === undefined ? CLASSES : CLASSES.filter((c) => c.teacher_id === tid);
        return { c: rows.length };
      },
    },
    {
      match: 'FROM classes c LEFT JOIN teachers',
      all: (p) => {
        // list: có filter -> [teacherId, limit, offset], không filter -> [limit, offset]
        const tid = p.length > 2 ? (p[0] as number) : undefined;
        return tid === undefined ? CLASSES : CLASSES.filter((c) => c.teacher_id === tid);
      },
    },
  ];
  if (restore) restore();
  restore = installMockDb(routes);
}

beforeEach(() => setupMock());
after(() => restore?.());

describe('getTeacherDetail', () => {
  it('trả đúng giáo viên kèm số lớp đang dạy', async () => {
    const t = await getTeacherDetail(null, 7);
    assert.equal(t.name, 'Nguyễn Văn A');
    assert.equal(t.class_count, 2);
    assert.equal(t.phone, '0901112222');
  });

  it('404 khi giáo viên không tồn tại', async () => {
    teacherRow = undefined;
    await assert.rejects(
      () => getTeacherDetail(null, 999),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('404 khi giáo viên thuộc center khác', async () => {
    teacherRow = { ...TEACHER, center_id: 99 };
    await assert.rejects(
      () => getTeacherDetail(3, 7),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'NOT_FOUND');
        return true;
      }
    );
  });
});

describe('listClasses ?teacher_id=', () => {
  it('chỉ trả lớp của giáo viên được lọc', async () => {
    const res = await listClasses(CTX, { teacherId: 7 });
    assert.equal(res.data.length, 2);
    assert.equal(res.pagination.total, 2);
    assert.ok(res.data.every((c) => (c as MockClass).teacher_id === 7));
  });

  it('giáo viên không dạy lớp nào -> danh sách rỗng', async () => {
    const res = await listClasses(CTX, { teacherId: 123 });
    assert.equal(res.data.length, 0);
    assert.equal(res.pagination.total, 0);
  });

  it('không truyền teacherId -> behavior cũ, trả đủ danh sách', async () => {
    const res = await listClasses(CTX);
    assert.equal(res.data.length, 3);
    assert.equal(res.pagination.total, 3);
  });
});
