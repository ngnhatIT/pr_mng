/**
 * Test ?search= cho listClasses (classes.service.ts) — KHÔNG cần PostgreSQL.
 * Mock db layer bằng mock-db.ts.
 *
 * - search ra đúng lớp (mô phỏng ILIKE, vì pg-compat dịch LIKE -> ILIKE trên PG thật)
 * - search chuỗi có wildcard (%, _) được escape nên không match toàn bộ DB
 * - không search -> trả đủ danh sách
 */
// PHẢI đặt trước mọi import db — config/env fail-fast nếu thiếu DATABASE_URL
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://mock:mock@localhost:5432/mockdb';

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMockDb, type MockRoute } from '../../db/mock-db';
import { listClasses } from './classes.service';

// centerId null = superadmin: classScopeWhere không thêm điều kiện center
const CTX = { centerId: null, role: 'admin', teacherId: null };

interface MockClass {
  id: number;
  name: string;
  teacher_name: string | null;
  room_name: string | null;
  student_count: number;
}

const CLASSES: MockClass[] = [
  { id: 1, name: 'IELTS 6.5 A', teacher_name: null, room_name: null, student_count: 5 },
  { id: 2, name: 'Giao tiếp B2', teacher_name: null, room_name: null, student_count: 3 },
  { id: 3, name: '100% Cam kết đỗ', teacher_name: null, room_name: null, student_count: 8 },
];

/**
 * Giải mã param LIKE %<escaped>% thành keyword gốc (bỏ % bao ngoài + unescape),
 * rồi lọc theo includes không phân biệt hoa thường như ILIKE trên PG thật.
 */
function matchKeyword(likeParam: unknown): MockClass[] {
  if (typeof likeParam !== 'string') return CLASSES;
  const inner = likeParam.startsWith('%') && likeParam.endsWith('%') ? likeParam.slice(1, -1) : likeParam;
  const kw = inner.replace(/\\(.)/g, '$1').toLowerCase();
  return CLASSES.filter((c) => c.name.toLowerCase().includes(kw));
}

/** Param LIKE (chuỗi bắt đầu bằng %) nếu có, ngược lại undefined. */
function likeParamOf(params: unknown[]): string | undefined {
  return params.find((p) => typeof p === 'string' && p.startsWith('%')) as string | undefined;
}

let seenParams: string[] = [];
let restore: (() => void) | null = null;

function setupMock(): void {
  seenParams = [];
  const routes: MockRoute[] = [
    // Route cụ thể đặt trước route chung
    {
      match: 'SELECT COUNT(*) as c FROM classes c',
      get: (p) => ({ c: matchKeyword(likeParamOf(p)).length }),
    },
    {
      match: 'FROM classes c LEFT JOIN teachers',
      all: (p) => {
        const kw = likeParamOf(p);
        if (kw !== undefined) seenParams.push(kw);
        return matchKeyword(kw);
      },
    },
  ];
  if (restore) restore();
  restore = installMockDb(routes);
}

beforeEach(() => setupMock());
after(() => restore?.());

describe('listClasses ?search=', () => {
  it('search ra đúng lớp theo tên (không phân biệt hoa thường)', async () => {
    const res = await listClasses(CTX, { search: 'ielts' });
    assert.equal(res.data.length, 1);
    assert.equal((res.data[0] as MockClass).name, 'IELTS 6.5 A');
    assert.equal(res.pagination.total, 1);
  });

  it('không search -> trả đủ danh sách', async () => {
    const res = await listClasses(CTX);
    assert.equal(res.data.length, 3);
  });

  it('search chuỗi rỗng -> behavior cũ, trả đủ', async () => {
    const res = await listClasses(CTX, { search: '' });
    assert.equal(res.data.length, 3);
    assert.equal(seenParams.length, 0); // không truyền param LIKE khi search rỗng
  });

  it('wildcard % được escape nên không match toàn bộ DB', async () => {
    const res = await listClasses(CTX, { search: '100%' });
    assert.equal(res.data.length, 1);
    assert.equal((res.data[0] as MockClass).name, '100% Cam kết đỗ');
    assert.equal(seenParams[0], '%100\\%%'); // \% trong param, không phải % trần
  });

  it('wildcard _ được escape nên không match toàn bộ DB', async () => {
    const res = await listClasses(CTX, { search: '_' });
    assert.equal(res.data.length, 0);
    assert.equal(seenParams[0], '%\\_%');
  });
});
