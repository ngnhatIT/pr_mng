// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n';
import { NotificationBell } from './NotificationBell';

const readAll = vi.fn(() => Promise.resolve({ updated: 1 }));
vi.mock('./notifications.api', () => ({
  inboxApi: {
    unreadCount: () => Promise.resolve({ unread: 1 }),
    list: () =>
      Promise.resolve({
        unread: 1,
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        data: [
          {
            id: 7,
            kind: 'payment_confirmed',
            params: { amount: 1500000, invoice: 12 },
            title: null,
            body: 'câu dự phòng',
            link: '/parent/children/3',
            read_at: null,
            created_at: '2026-10-11 09:00:00',
          },
        ],
      }),
    readAll: () => readAll(),
    read: () => Promise.resolve({ ok: true }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe('NotificationBell', () => {
  it('hiện số chưa đọc, mở panel dịch theo kind + params, đọc hết về 0', async () => {
    await i18n.changeLanguage('en');
    const el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    act(() =>
      root!.render(
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      )
    );
    await flush();
    const btn = el.querySelector('button.notif-btn') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Notifications, 1 unread');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    act(() => btn.click());
    await flush();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const body = el.querySelector('.notif-body')?.textContent ?? '';
    expect(body).toContain('1,500,000 VND');
    expect(body).toContain('#12');

    const markAll = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Mark all as read')!;
    act(() => markAll.click());
    await flush();
    expect(readAll).toHaveBeenCalledOnce();
    expect(btn.getAttribute('aria-label')).toBe('Notifications');
    expect(el.querySelector('.notif-item.is-unread')).toBeNull();
    await i18n.changeLanguage('vi');
  });
});
