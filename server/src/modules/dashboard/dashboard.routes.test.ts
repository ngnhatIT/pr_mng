/**
 * Unit test monthRange — logic biên tháng cho query doanh thu dashboard.
 * Range trên paid_at text ISO phải tương đương substr(paid_at,1,7) nhưng dùng được index.
 */
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test');

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthRange } from './dashboard.routes';

describe('monthRange', () => {
  it('tháng thường: đầu tháng này -> đầu tháng sau', () => {
    assert.deepEqual(monthRange('2026-10-10'), ['2026-10-01', '2026-11-01']);
    assert.deepEqual(monthRange('2026-01-15'), ['2026-01-01', '2026-02-01']);
  });

  it('biên tháng 12 -> sang năm mới', () => {
    assert.deepEqual(monthRange('2026-12-31'), ['2026-12-01', '2027-01-01']);
  });

  it('range tương đương substr(paid_at,1,7) trên text ISO', () => {
    const [start, next] = monthRange('2026-10-10');
    const inRange = (paidAt: string) => paidAt >= start && paidAt < next;
    // Các paid_at text 'YYYY-MM-DD HH24:MI:SS' của tháng 10/2026 đều khớp
    for (const p of ['2026-10-01 00:00:00', '2026-10-15 08:30:00', '2026-10-31 23:59:59']) {
      assert.ok(inRange(p), `${p} phải nằm trong tháng`);
      assert.equal(p.slice(0, 7), '2026-10');
    }
    // Tháng kề trước/sau không khớp
    for (const p of ['2026-09-30 23:59:59', '2026-11-01 00:00:00']) {
      assert.ok(!inRange(p), `${p} không được nằm trong tháng`);
    }
  });
});
