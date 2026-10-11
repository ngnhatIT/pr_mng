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
import { Students } from './Students';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'students', ...o }));
const st = (id: number, name: string) => ({
  id,
  code: `HV${id}`,
  name,
  phone: null,
  email: null,
  dob: null,
  address: null,
  status: 'studying',
  note: null,
  center_id: 1,
});

let n = 0;
function setup(perms: string[], totalPages = 1, extra: Record<string, unknown> = {}) {
  setAuth(`stu${++n}`, { id: 1, username: 'a', role: 'admin', name: 'A' });
  return mockFetch({
    'GET /roles/me/permissions': perms.map((code) => ({ code })),
    'GET /students': (c: Call) => ({
      data: [st(5, `An p${c.query.get('page')}`)],
      pagination: { page: Number(c.query.get('page')), limit: 20, total: 1, totalPages },
    }),
    ...extra,
  });
}
const render = (at = '/app/students') => renderRoutes([{ path: '/app/students', element: <Students /> }], at);
const lists = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/students');
const dialogInputs = () => $$<HTMLInputElement>('[role="dialog"] input');

afterEach(cleanup);

describe('Students', () => {
  it('trang + lọc lấy từ URL; trang vượt totalPages (vd. vừa xóa) -> lùi về trang hợp lệ', async () => {
    const calls = setup([], 1);
    const router = await render('/app/students?status=paused&page=3');
    expect(lists(calls)[0].query.get('status')).toBe('paused');
    expect(lists(calls)[0].query.get('page')).toBe('3');
    expect(router.state.location.search).toBe('?status=paused'); // page=1 là mặc định -> bỏ khỏi URL
    expect(lists(calls).at(-1)!.query.get('page')).toBe('1');
    expect($('tbody')!.textContent).toContain('An p1');
    // Không có quyền -> không có nút thêm/sửa/xóa
    expect($$('button').some((b) => b.textContent?.includes(t('add')))).toBe(false);
  });

  it('thêm học viên: validate inline (tên, SĐT) rồi POST, đóng form và tải lại', async () => {
    const calls = setup(['students.create'], 1, { 'POST /students': st(6, 'Bình') });
    await render();
    await click(byText(t('add')));
    await click($('[role="dialog"] button[type="submit"]'));
    expect($('[role="dialog"]')!.textContent).toContain(t('form.errors.nameRequired'));
    await type(dialogInputs()[1], 'Trần Bình');
    await type(dialogInputs()[2], '12345');
    await click($('[role="dialog"] button[type="submit"]'));
    expect($('[role="dialog"]')!.textContent).toContain(t('form.errors.phoneInvalid'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await type(dialogInputs()[2], '0912345678');
    await click($('[role="dialog"] button[type="submit"]'));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Trần Bình',
      phone: '0912345678',
      status: 'studying',
    });
    expect($('[role="dialog"]')).toBeNull();
    expect(lists(calls)).toHaveLength(2);
    expect($('.toast-success')!.textContent).toBe(t('toast.saved'));
  });

  it('xóa: xác nhận -> DELETE; server từ chối -> toast câu của server, giữ hộp thoại', async () => {
    const calls = setup(['students.delete'], 1, {
      'DELETE /students/5': json(409, { error: 'Học viên còn hóa đơn', code: 'CONFLICT' }),
    });
    await render();
    await click(byText(String(i18n.t('actions.delete', { ns: 'common' }))));
    expect($('[role="dialog"]')!.textContent).toContain(t('delete.message', { name: 'An p1' }));
    await click($$('[role="dialog"] .modal-actions .btn').at(-1)!);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/students/5')).toBe(true);
    expect($('.toast-error')!.textContent).toBe('Học viên còn hóa đơn');
    expect($('[role="dialog"]')).not.toBeNull();
  });
});
