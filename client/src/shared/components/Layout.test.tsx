// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import '../../i18n';
import { Layout } from './Layout';

vi.mock('../../features/system/roles.api', () => ({ loadMyPermissions: () => Promise.resolve(new Set()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Layout drawer + Modal', () => {
  it('B3-1: mở drawer, mở rồi hủy hộp xác nhận đăng xuất -> body vẫn khóa scroll; đóng drawer mới mở khóa', async () => {
    const router = createMemoryRouter([{ path: '/app', element: <Layout /> }], { initialEntries: ['/app'] });
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      root = createRoot(el);
      root.render(<RouterProvider router={router} />);
    });
    const click = (sel: string) => act(() => (document.querySelector(sel) as HTMLElement).click());

    click('.menu-btn');
    expect(document.body.style.overflow).toBe('hidden');
    // Nút Đăng xuất ở chân sidebar -> ConfirmDialog
    click('.sidebar-foot-actions button:last-child');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    click('[role="dialog"] .modal-actions .btn:first-child'); // Hủy
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.body.style.overflow).toBe('hidden');

    click('.scrim');
    expect(document.body.style.overflow).toBe('');
  });
});
