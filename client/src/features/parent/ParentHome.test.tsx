// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
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
import { UnauthorizedListener } from '../../shared/api/UnauthorizedListener';
import { ParentHome } from './ParentHome';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'parent', ...o }));
const child = (id: number, name: string) => ({ id, name, code: `HV${id}`, classes: [{ id: 1, name: 'A1' }] });
const ov = (invoices: { amount: number; paid: number; status: string }[]) => ({ invoices });

const render = () =>
  renderRoutes(
    [
      {
        path: '/parent',
        element: (
          <>
            <UnauthorizedListener />
            <ParentHome />
          </>
        ),
      },
      { path: '/login', element: <UnauthorizedListener /> },
    ],
    '/parent'
  );
beforeEach(() => setAuth('ph', { id: 9, username: '0901', role: 'parent', name: 'Chị Hoa' }));
afterEach(cleanup);

describe('ParentHome', () => {
  it('danh sách con + thẻ công nợ cộng phần còn nợ của hóa đơn chưa trả đủ', async () => {
    mockFetch({
      'GET /parent/children': [child(1, 'An'), child(2, 'Bình')],
      'GET /parent/children/1/overview': ov([
        { amount: 1_000_000, paid: 400_000, status: 'partial' },
        { amount: 500_000, paid: 500_000, status: 'paid' },
      ]),
      'GET /parent/children/2/overview': ov([]),
    });
    await render();
    expect($$('.child-card')).toHaveLength(2);
    expect($$('.debt-row')).toHaveLength(1);
    expect($('.debt-row')!.textContent).toMatch(/An.*600\.000/);
    expect($('.debt-row a')!.getAttribute('href')).toBe('/parent/children/1?tab=tuition');
  });

  it('liên kết con: thiếu dữ liệu -> lỗi inline; sai mã -> lỗi server dưới ô mã; đúng -> POST + tải lại', async () => {
    let ok = false;
    const calls: Call[] = mockFetch({
      'GET /parent/children': [],
      'POST /parent/link': () =>
        ok ? { ok: true, student: child(3, 'Chi') } : json(404, { error: 'Không tìm thấy học viên' }),
    });
    await render();
    expect(document.body.textContent).toContain(t('home.emptyTitle'));
    const submit = () => click($('.parent-link-card button[type="submit"]'));
    await submit();
    expect($$('.field-error').map((e) => e.textContent)).toEqual([
      t('home.codeRequired'),
      t('home.dobRequired'),
    ]);
    const [code, dob] = $$<HTMLInputElement>('.parent-link-card input');
    await type(code, ' HV3 ');
    await type(dob, '2015-05-01');
    await submit();
    expect($('.field-error')!.textContent).toBe('Không tìm thấy học viên');
    ok = true;
    await submit();
    expect(calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({
      student_code: 'HV3',
      dob: '2015-05-01',
    });
    expect($('.toast-success')!.textContent).toBe(t('home.linkedSuccess', { name: 'Chi' }));
    expect(calls.filter((c) => c.path === '/parent/children')).toHaveLength(2);
  });

  it('B4-4: hết phiên -> đúng 1 toast (của UnauthorizedListener) và về trang login', async () => {
    mockFetch({
      'GET /parent/children': json(401, { error: 'expired' }),
      'POST /parent/refresh': json(401, {}),
    });
    const router = await render();
    expect($$('.toast').map((e) => e.textContent)).toEqual([
      String(i18n.t('api.sessionExpired', { ns: 'common' })),
    ]);
    expect(router.state.location.pathname).toBe('/login');
  });

  it('B4-4: 403 PASSWORD_CHANGE_REQUIRED -> không toast đè lên form đổi mật khẩu, hiện Thử lại', async () => {
    mockFetch({
      'GET /parent/children': json(403, { error: 'Bạn cần đổi mật khẩu', code: 'PASSWORD_CHANGE_REQUIRED' }),
    });
    await render();
    expect($('.toast')).toBeNull();
    expect(byText(String(i18n.t('actions.retry', { ns: 'common' })))).toBeTruthy();
  });
});
