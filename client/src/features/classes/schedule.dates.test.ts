import { describe, it, expect } from 'vitest';
import {
  addDaysIso,
  daysBetween,
  monthGridRange,
  shiftAnchor,
  startOfWeek,
  weekRange,
} from './schedule.dates';

describe('schedule dates', () => {
  it('tuần bắt đầu thứ Hai, kể cả khi ngày là Chủ Nhật', () => {
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05'); // CN
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12'); // T2
    expect(weekRange('2026-10-14')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('lưới tháng phủ trọn tuần, qua năm mới đúng', () => {
    expect(monthGridRange('2026-10-20')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(monthGridRange('2026-12-05')).toEqual({ from: '2026-11-30', to: '2027-01-03' });
    expect(daysBetween('2026-09-28', '2026-11-01')).toHaveLength(35);
  });

  it('trước/sau theo tuần và tháng; cộng ngày qua tháng 2', () => {
    expect(shiftAnchor('2026-10-14', 'week', -1)).toBe('2026-10-07');
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });
});
