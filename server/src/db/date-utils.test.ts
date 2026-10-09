/** Unit test cho db/date-utils.ts — hàm thuần, không cần DB */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toISODate, parseISODate, addDays, ourDayOfWeek, formatSchedule } from './date-utils';

describe('date-utils', () => {
  it('toISODate trả về YYYY-MM-DD', () => {
    assert.equal(toISODate(new Date(2026, 9, 8)), '2026-10-08');
  });

  it('parseISODate <-> toISODate round-trip', () => {
    const d = parseISODate('2026-10-08');
    assert.equal(toISODate(d), '2026-10-08');
  });

  it('addDays cộng/trừ đúng ngày, qua tháng', () => {
    assert.equal(toISODate(addDays(parseISODate('2026-01-31'), 1)), '2026-02-01');
    assert.equal(toISODate(addDays(parseISODate('2026-10-08'), -8)), '2026-09-30');
  });

  it('ourDayOfWeek: Thứ 2 = 2, Chủ nhật = 8 (khớp DAY_NAMES)', () => {
    // 2026-10-11 là Chủ nhật
    assert.equal(ourDayOfWeek(parseISODate('2026-10-11')), 8);
    // 2026-10-12 là Thứ 2
    assert.equal(ourDayOfWeek(parseISODate('2026-10-12')), 2);
  });

  it('formatSchedule parse JSON lịch học', () => {
    const s = formatSchedule(
      JSON.stringify([
        { day: 2, start: '18:00', end: '20:00' },
        { day: 4, start: '18:00', end: '20:00' },
      ])
    );
    assert.equal(s, 'Thứ Hai 18:00-20:00, Thứ Tư 18:00-20:00');
  });

  it('formatSchedule chịu được JSON hỏng', () => {
    assert.doesNotThrow(() => formatSchedule('không phải json'));
  });
});
