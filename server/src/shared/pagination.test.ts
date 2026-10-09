/** Unit test cho shared/pagination.ts */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, paginate, DEFAULT_LIMIT, MAX_LIMIT } from './pagination';

describe('parsePagination', () => {
  it('mặc định page=1, limit=20', () => {
    const p = parsePagination({});
    assert.equal(p.page, 1);
    assert.equal(p.limit, DEFAULT_LIMIT);
    assert.equal(p.offset, 0);
  });

  it('parse page/limit từ string query', () => {
    const p = parsePagination({ page: '3', limit: '10' });
    assert.equal(p.page, 3);
    assert.equal(p.limit, 10);
    assert.equal(p.offset, 20);
  });

  it('clamp limit tối đa 100', () => {
    const p = parsePagination({ limit: '9999' });
    assert.equal(p.limit, MAX_LIMIT);
  });

  it('giá trị không hợp lệ -> về mặc định', () => {
    assert.equal(parsePagination({ page: 'abc' }).page, 1);
    assert.equal(parsePagination({ page: '-5' }).page, 1);
    assert.equal(parsePagination({ limit: '0' }).limit, DEFAULT_LIMIT);
  });
});

describe('paginate', () => {
  it('đóng gói đúng envelope', () => {
    const r = paginate([1, 2], 45, 2, 20);
    assert.deepEqual(r.data, [1, 2]);
    assert.equal(r.pagination.page, 2);
    assert.equal(r.pagination.total, 45);
    assert.equal(r.pagination.totalPages, 3);
  });

  it('total=0 vẫn có totalPages=1', () => {
    const r = paginate([], 0, 1, 20);
    assert.equal(r.pagination.totalPages, 1);
  });
});
