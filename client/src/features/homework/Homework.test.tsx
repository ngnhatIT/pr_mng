// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import { $, $$, byText, cleanup, click, mockFetch, renderRoutes, type, type Call } from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { Homework } from './Homework';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'homework', ...o }));
const hw = (id: number, status: string, kind = 'homework') => ({
  id,
  title: `Bài ${id}`,
  kind,
  status,
  due_date: null,
  class_name: 'A1',
  completed_count: 3,
  student_count: 4,
});

function setup(role = 'admin') {
  setAuth(`hw-${role}`, { id: 1, username: 'u', role, name: 'U' });
  return mockFetch({
    'GET /classes': {
      data: [{ id: 1, name: 'A1', status: 'active' }],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    },
    'GET /homework/stats': { total: 2, dueSoon: 0, overdue: 0, drafts: 1 },
    'GET /homework': {
      data: [hw(1, 'draft'), hw(2, 'published', 'quiz')],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    },
    'POST /homework/1/publish': { ok: true },
    'POST /homework/2/unpublish': { ok: true },
    'POST /homework/1/reuse': { created: { ...hw(9, 'draft'), title: 'Bài 1 (bản sao)' }, count: 1 },
    'GET /homework/9': { id: 9, attachments: [] },
    'GET /homework/rubrics/list': [],
  });
}
const render = () => renderRoutes([{ path: '/app/homework', element: <Homework /> }], '/app/homework');
const lists = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/homework');
const row = (title: string) => $$('tbody tr').find((r) => r.textContent!.includes(title))!;
const inRow = (title: string, text: string) =>
  [...row(title).querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;

afterEach(cleanup);

describe('Homework (danh sách)', () => {
  it('tab trạng thái + lọc lớp -> gọi lại API với tham số và ghi URL; tiến độ 3/4', async () => {
    const calls = setup();
    const router = await render();
    expect(row('Bài 1').textContent).toContain('3/4');
    expect($('.hw-action-icon:not(.btn-primary)')).not.toBeNull(); // quản trị: có thống kê/ngân hàng
    await click(byText(t('status.draft'), '.hw-tabs button'));
    expect(lists(calls).at(-1)!.query.get('status')).toBe('draft');
    await type($(`select[aria-label="${t('filters.classFilterLabel')}"]`), '1');
    expect(lists(calls).at(-1)!.query.get('class_id')).toBe('1');
    expect(new URLSearchParams(router.state.location.search).get('class_id')).toBe('1');
  });

  it('đăng bài nháp; gỡ đăng phải xác nhận; mỗi lần đổi đều tải lại list + thống kê', async () => {
    const calls = setup();
    await render();
    await click(inRow('Bài 1', t('actions.publish')));
    await click(inRow('Bài 2', t('actions.unpublish')));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/homework/1/publish']);
    await click($$('[role="dialog"] .modal-actions .btn').at(-1)!);
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/homework/1/publish',
      '/homework/2/unpublish',
    ]);
    expect(lists(calls)).toHaveLength(3);
    expect(calls.filter((c) => c.path === '/homework/stats')).toHaveLength(3);
  });

  it('dùng lại bài -> tạo bản sao rồi mở ngay form sửa bản sao', async () => {
    const calls = setup();
    await render();
    await click(inRow('Bài 1', t('actions.reuse')));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/homework/1/reuse')).toBe(true);
    expect($('[role="dialog"]')!.textContent).toContain(t('form.titleEdit'));
    expect($<HTMLInputElement>('[role="dialog"] input[maxlength="200"]')!.value).toBe('Bài 1 (bản sao)');
  });

  it('portal giáo viên: ẩn thống kê/ngân hàng câu hỏi, vẫn giao bài được', async () => {
    setup('teacher');
    await render();
    expect($$('button').some((b) => b.textContent?.includes(t('actions.create')))).toBe(true);
    expect($('.hw-action-icon:not(.btn-primary)')).toBeNull();
  });
});
