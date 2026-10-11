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
  renderPage,
  type,
  type Call,
} from '../../test-utils';
import { getToken, getUser, setAuth } from '../api/client';
import { ChangePasswordModal } from './ChangePasswordModal';

const t = (k: string) => String(i18n.t(k, { ns: 'common' }));
let closed = 0;
const open = () => renderPage(<ChangePasswordModal onClose={() => closed++} />);
async function fill(old: string, pw: string, confirm: string) {
  const [a, b, c] = $$<HTMLInputElement>('[role="dialog"] input');
  await type(a, old);
  await type(b, pw);
  await type(c, confirm);
  await click($('[role="dialog"] button[type="submit"]'));
}
const fieldError = () => $$('.field-error').map((e) => e.textContent);

beforeEach(() => {
  closed = 0;
  setAuth('cp', { id: 1, username: 'a', role: 'admin', name: 'A', must_change_password: true });
});
afterEach(cleanup);

describe('ChangePasswordModal', () => {
  it('mật khẩu mới < 8 ký tự (chặn bởi minLength) / nhập lại không khớp (lỗi inline) -> không gọi API', async () => {
    const calls = mockFetch({});
    await open();
    await fill('old12345', 'short', 'short');
    expect($<HTMLInputElement>('[role="dialog"] input[minlength="8"]')!.validity.tooShort).toBe(true);
    await fill('old12345', 'newpass123', 'newpass124');
    expect(fieldError()).toEqual([t('changePassword.mismatch')]);
    expect(calls).toHaveLength(0);
  });

  it('lỗi server: SAME_PASSWORD hiện dưới ô mới, sai mật khẩu cũ hiện dưới ô hiện tại', async () => {
    let res = json(400, { error: 'Trùng mật khẩu cũ', code: 'SAME_PASSWORD' });
    mockFetch({ 'POST /auth/change-password': () => res });
    await open();
    await fill('old12345', 'newpass123', 'newpass123');
    const fields = () => $$('[role="dialog"] .field');
    expect(fields()[1].querySelector('.field-error')!.textContent).toBe('Trùng mật khẩu cũ');
    res = json(400, { error: 'Sai mật khẩu', code: 'BAD_REQUEST' });
    await click($('[role="dialog"] button[type="submit"]'));
    expect(fields()[0].querySelector('.field-error')!.textContent).toBe('Sai mật khẩu');
    expect(closed).toBe(0);
  });

  it('thành công -> gửi old/new, gỡ cờ bắt đổi, toast + đóng', async () => {
    const calls: Call[] = mockFetch({
      'POST /auth/change-password': { ok: true },
      'POST /auth/refresh': json(401, {}),
    });
    await open();
    await fill('old12345', 'newpass123', 'newpass123');
    expect(calls[0].body).toEqual({ old_password: 'old12345', new_password: 'newpass123' });
    expect(getUser()!.must_change_password).toBe(false);
    expect($('.toast-success')!.textContent).toBe(t('changePassword.success'));
    expect(closed).toBe(1);
  });

  it('đăng xuất thiết bị khác: xác nhận -> POST logout-all, dùng token mới server trả', async () => {
    mockFetch({ 'POST /auth/logout-all': { ok: true, token: 'fresh' } });
    await open();
    await click(byText(t('changePassword.logoutAll')));
    await click($$('[role="dialog"]').at(-1)!.querySelector('.modal-actions .btn:last-child'));
    expect(getToken()).toBe('fresh');
    expect(closed).toBe(1);
  });
});
