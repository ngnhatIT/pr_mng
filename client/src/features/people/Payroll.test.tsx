// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import { $$, cleanup, mockFetch, renderPage } from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { formatVND } from '../../shared/types';
import { Payroll } from './Payroll';
import { TeacherSalary } from '../teacher/TeacherSalary';

const hint = (ns: string, key: string, avg: number) => String(i18n.t(key, { ns, avg: formatVND(avg) }));

afterEach(cleanup);

describe('B6-2: đơn giá theo tháng', () => {
  it('Payroll: hiện month_rate (không phải giá hôm nay); gợi ý "đổi trong tháng" chỉ khi mixed_rates', async () => {
    setAuth('pay1', { id: 1, username: 'admin', role: 'admin', name: 'A' });
    mockFetch({
      'GET /roles/me/permissions': [],
      'GET /payroll': [
        // Tháng cũ trả trọn 200k, hôm nay đã đổi 250k
        {
          teacher_id: 1,
          teacher_name: 'An',
          sessions: 2,
          per_session: 250000,
          total: 400000,
          avg_rate: 200000,
          mixed_rates: false,
          month_rate: 200000,
        },
        {
          teacher_id: 2,
          teacher_name: 'Bình',
          sessions: 2,
          per_session: 150000,
          total: 250000,
          avg_rate: 125000,
          mixed_rates: true,
          month_rate: 150000,
        },
        // Server cũ (không month_rate) -> per_session
        { teacher_id: 3, teacher_name: 'Chi', sessions: 1, per_session: 90000, total: 90000 },
      ],
    });
    await renderPage(<Payroll />);
    const cells = $$('tbody tr').map((tr) => tr.querySelectorAll('td')[2].textContent);
    expect(cells[0]).toBe(formatVND(200000));
    expect(cells[1]).toBe(formatVND(150000) + hint('people', 'payroll.mixedRate', 125000));
    expect(cells[2]).toBe(formatVND(90000));
  });

  it('TeacherSalary: hiện month_rate, không có gợi ý khi tháng chỉ 1 đơn giá', async () => {
    setAuth('pay2', { id: 2, username: 'gv', role: 'teacher', name: 'GV' });
    mockFetch({
      'GET /teacher/payroll': {
        sessions: 2,
        per_session: 250000,
        total: 400000,
        avg_rate: 200000,
        mixed_rates: false,
        month_rate: 200000,
      },
    });
    await renderPage(<TeacherSalary />);
    const text = document.querySelector('.salary-breakdown')!.textContent!;
    expect(text).toContain(formatVND(200000));
    expect(text).not.toContain(formatVND(250000));
    expect(text).not.toContain(hint('teacher', 'salary.mixedRate', 200000));
  });
});
