// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { $, $$, cleanup, click, mockFetch, renderRoutes, type, json } from '../../test-utils';
import { Login } from './Login';
import { ParentLogin } from '../parent/ParentLogin';

afterEach(cleanup);

const routes = [
  { path: '/login', element: <Login /> },
  { path: '/parent/login', element: <ParentLogin /> },
  { path: '*', element: <div id="landed" /> },
];

async function staffLogin(role: string, next?: string) {
  if (next) sessionStorage.setItem('edu_next', next);
  const calls = mockFetch({
    'POST /auth/login': { token: 't', user: { id: 1, username: 'u', role, name: 'U' } },
  });
  const router = await renderRoutes(routes, '/login');
  const [user, pw] = $$<HTMLInputElement>('.login-card input');
  await type(user, 'u');
  await type(pw, 'secret');
  await click($('button[type="submit"]'));
  return { calls, path: router.state.location.pathname + router.state.location.search };
}

describe('Login: điều hướng sau đăng nhập (B4-2)', () => {
  it('gửi đúng body; không có deep-link -> về home theo role', async () => {
    const { calls, path } = await staffLogin('teacher');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/auth/login',
      body: { username: 'u', password: 'secret' },
    });
    expect(path).toBe('/teacher');
  });

  it('deep-link của portal khác (phụ huynh hết phiên trên máy dùng chung) bị bỏ qua', async () => {
    expect((await staffLogin('teacher', '/parent')).path).toBe('/teacher');
    cleanup();
    expect((await staffLogin('teacher', '/app/students')).path).toBe('/teacher');
    cleanup();
    expect((await staffLogin('admin', '/teacher/luong')).path).toBe('/app');
  });

  it('deep-link cùng portal được giữ', async () => {
    expect((await staffLogin('teacher', '/teacher/diem-so')).path).toBe('/teacher/diem-so');
    cleanup();
    expect((await staffLogin('admin', '/app/tuition?tab=debt')).path).toBe('/app/tuition?tab=debt');
  });

  it('thiếu thông tin -> lỗi inline, không gọi API; sai mật khẩu -> câu của server dưới ô mật khẩu', async () => {
    const calls = mockFetch({ 'POST /auth/login': json(401, { error: 'Sai mật khẩu' }) });
    await renderRoutes(routes, '/login');
    await click($('button[type="submit"]'));
    expect(calls).toHaveLength(0);
    expect($$('.field-error').length).toBe(2);
    const [user, pw] = $$<HTMLInputElement>('.login-card input');
    await type(user, 'u');
    await type(pw, 'x');
    await click($('button[type="submit"]'));
    expect(document.body.textContent).toContain('Sai mật khẩu');
  });
});

describe('ParentLogin (B4-2)', () => {
  it('chỉ theo deep-link /parent/*', async () => {
    const login = async (next: string) => {
      sessionStorage.setItem('edu_next', next);
      mockFetch({
        'POST /parent/login': { token: 't', parent: { id: 9, name: 'P', phone: '0901234567' } },
      });
      const router = await renderRoutes(routes, '/parent/login');
      const [phone, pw] = $$<HTMLInputElement>('input');
      await type(phone, '0901234567');
      await type(pw, 'secret');
      await click($('button[type="submit"]'));
      return router.state.location.pathname;
    };
    expect(await login('/parent/children/3')).toBe('/parent/children/3');
    cleanup();
    expect(await login('/app/students')).toBe('/parent');
  });
});
