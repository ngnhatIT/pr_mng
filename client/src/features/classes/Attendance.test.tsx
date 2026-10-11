// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import {
  $,
  $$,
  byText,
  cleanup,
  click,
  json,
  mockFetch,
  renderRoutes,
  type,
  type Call,
} from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { Attendance } from './Attendance';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'classes', ...o }));
const rows = (sid: number) => [
  { id: 1, name: 'An', code: 'S1', status: null, note: null },
  { id: 2, name: 'Bình', code: 'S2', status: null, note: null },
  { id: 3, name: `Chi ${sid}`, code: 'S3', status: 'present', note: 'cũ' },
];

let n = 0;
function setup(perms: string[], extra: Record<string, unknown> = {}) {
  setAuth(`att${++n}`, { id: 1, username: 'gv', role: 'teacher', name: 'GV' });
  return mockFetch({
    'GET /roles/me/permissions': perms.map((code) => ({ code })),
    'GET /classes': {
      data: [
        { id: 1, name: 'A1', status: 'active' },
        { id: 2, name: 'Cũ', status: 'ended' },
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    },
    'GET /classes/1/sessions': [
      { id: 10, date: '2026-10-01', topic: 'Unit 1', attendance_count: 1 },
      { id: 11, date: '2026-10-08', topic: null, attendance_count: 0 },
    ],
    'GET /sessions/10/attendance': { session: { id: 10, topic: 'Unit 1' }, students: rows(10) },
    'GET /sessions/11/attendance': { session: { id: 11, topic: null }, students: rows(11) },
    'POST /sessions/10/attendance': { saved: 2 },
    'PUT /sessions/10': { ok: true },
    ...extra,
  });
}
const render = () =>
  renderRoutes(
    [{ path: '/teacher/diem-danh', element: <Attendance /> }],
    '/teacher/diem-danh?class=1&session=10'
  );
const radio = (name: string, status: string) =>
  $(`[aria-label="${t('attendance.row.statusAria', { name })}"] .seg-${status}`);
const post = (calls: Call[]) => calls.filter((c) => c.method === 'POST' || c.method === 'PUT');

afterEach(cleanup);

describe('Attendance', () => {
  it('deep-link lớp+buổi; chỉ lớp đang hoạt động trong dropdown; còn người chưa tick -> hỏi trước khi lưu, chỉ gửi người đã tick', async () => {
    const calls = setup([]);
    await render();
    expect($$('select')[0].querySelectorAll('option')).toHaveLength(2); // placeholder + A1
    expect($$('.att-item')).toHaveLength(3);
    await click(radio('An', 'late'));
    await click(byText(t('attendance.save')));
    expect(post(calls)).toHaveLength(0);
    expect($('[role="dialog"]')!.textContent).toContain(
      t('attendance.confirmUnmarked.message', { count: 1 })
    );
    await click($$('[role="dialog"] .modal-actions .btn').at(-1)!);
    expect(post(calls)).toEqual([
      expect.objectContaining({
        path: '/sessions/10/attendance',
        body: {
          records: [
            { student_id: 1, status: 'late', note: '' },
            { student_id: 3, status: 'present', note: 'cũ' },
          ],
        },
      }),
    ]);
    // Giáo viên không có sessions.manage: ô chủ đề chỉ đọc, không gọi PUT chủ đề
    expect($<HTMLInputElement>(`[placeholder="${t('attendance.topic.placeholder')}"]`)!.readOnly).toBe(true);
  });

  it('có thay đổi chưa lưu -> đổi buổi phải xác nhận; Hủy giữ nguyên, Xác nhận mới tải buổi mới', async () => {
    const calls = setup([]);
    await render();
    await click(byText(t('attendance.toolbar.allPresent')));
    await type($$('select')[1], '11');
    expect($('[role="dialog"]')!.textContent).toContain(t('attendance.discard.title'));
    await click($('[role="dialog"] .modal-actions .btn')); // Hủy
    expect($$<HTMLSelectElement>('select')[1].value).toBe('10');
    expect(calls.some((c) => c.path === '/sessions/11/attendance')).toBe(false);

    await type($$('select')[1], '11');
    await click($$('[role="dialog"] .modal-actions .btn').at(-1)!);
    expect(calls.some((c) => c.path === '/sessions/11/attendance')).toBe(true);
    expect(document.body.textContent).toContain('Chi 11');
  });

  it('quản trị sửa chủ đề -> lưu điểm danh trước rồi PUT chủ đề; lỗi lưu hiện ngay savebar, giữ dữ liệu', async () => {
    let fail = true;
    const calls = setup(['sessions.manage'], {
      'POST /sessions/10/attendance': () => (fail ? json(400, { error: 'Buổi đã khóa' }) : { saved: 3 }),
    });
    await render();
    await click(byText(t('attendance.toolbar.allPresent')));
    await type($(`[placeholder="${t('attendance.topic.placeholder')}"]`), 'Unit 2');
    await click(byText(t('attendance.save')));
    expect($('.att-savebar [role="alert"]')!.textContent).toBe('Buổi đã khóa');
    expect(radio('An', 'present')!.getAttribute('aria-checked')).toBe('true');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    fail = false;
    await click(byText(t('attendance.save')));
    expect(post(calls).map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /sessions/10/attendance',
      'POST /sessions/10/attendance',
      'PUT /sessions/10',
    ]);
    expect(post(calls).at(-1)!.body).toEqual({ topic: 'Unit 2' });
    expect($('.att-savebar [role="alert"]')).toBeNull();
  });
});
