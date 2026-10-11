// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import '../../i18n';
import { PasswordChangeGate } from './PasswordChangeGate';
import { PASSWORD_CHANGE_EVENT, setAuth, updateUser } from '../api/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '*', element: <PasswordChangeGate /> }], {
    initialEntries: [path],
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(<RouterProvider router={router} />);
  });
}

// Form được lazy-load: chờ vài tick cho chunk resolve
async function dialog() {
  for (let i = 0; i < 50 && !document.querySelector('[role="dialog"]'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return document.querySelector('[role="dialog"]');
}

const user = { id: 1, username: 'a', role: 'admin', name: 'A' };

describe('PasswordChangeGate', () => {
  it('user có must_change_password -> form đổi mật khẩu bắt buộc (không có nút X); trang login thì không', async () => {
    setAuth('t', { ...user, must_change_password: true });
    await renderAt('/login');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => root!.unmount());
    await renderAt('/app');
    expect(await dialog()).not.toBeNull();
    expect(document.querySelector('.modal-close')).toBeNull();
    // B5-3: focus ngay ô mật khẩu hiện tại
    expect(document.activeElement).toBe(document.querySelector('input[autocomplete="current-password"]'));
  });

  it('event 403 từ api() mở form ngay trên trang đang đứng', async () => {
    setAuth('t', user);
    await renderAt('/app/students');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    updateUser({ must_change_password: true });
    act(() => {
      window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
    });
    expect(await dialog()).not.toBeNull();
  });
});
