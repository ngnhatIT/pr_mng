// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Link, Outlet, RouterProvider, useSearchParams } from 'react-router-dom';
import i18n from '../i18n';
import { UnsavedChangesPrompt } from './App';
import { Modal } from '../shared/components/Modal';
import { useUnsavedGuard } from '../shared/hooks/useUnsavedGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function DirtyPage() {
  const [dirty, setDirty] = useState(true);
  const [, setParams] = useSearchParams();
  useUnsavedGuard(dirty);
  return (
    <>
      <Link id="go" to="/other">
        go
      </Link>
      <button id="save" onClick={() => setDirty(false)} />
      <button id="query" onClick={() => setParams({ page: '2' })} />
    </>
  );
}

function ModalPage() {
  return (
    <Modal title="M" dirty onClose={() => {}}>
      <Link id="modal-go" to="/other">
        go
      </Link>
    </Modal>
  );
}

function setup(path = '/form') {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Outlet />
            <UnsavedChangesPrompt />
          </>
        ),
        children: [
          { path: '/form', element: <DirtyPage /> },
          { path: '/modal', element: <ModalPage /> },
          { path: '/other', element: <div id="other" /> },
        ],
      },
    ],
    { initialEntries: [path] }
  );
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<RouterProvider router={router} />));
  return router;
}

const click = (id: string) => act(() => (document.getElementById(id) as HTMLElement).click());
// Dialog nằm SAU cùng trong DOM = hiện trên cùng (các modal cùng z-index)
const dialogTitle = () => [...document.querySelectorAll('[role="dialog"] .modal-title')].pop()?.textContent;
const buttonByText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent === text
  )!;

describe('UnsavedChangesPrompt (UX-4: chặn điều hướng trong app khi form dirty)', () => {
  it('bấm link khi dirty -> hỏi; Hủy ở lại, Bỏ thay đổi thì đi', async () => {
    const router = setup();
    click('go');
    expect(router.state.location.pathname).toBe('/form');
    expect(dialogTitle()).toBe(i18n.t('discard.title', { ns: 'common' }));

    act(() => buttonByText(i18n.t('actions.cancel', { ns: 'common' })).click());
    expect(router.state.location.pathname).toBe('/form');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    click('go');
    await act(async () => buttonByText(i18n.t('discard.confirm', { ns: 'common' })).click());
    expect(router.state.location.pathname).toBe('/other');
    expect(document.getElementById('other')).not.toBeNull();
  });

  it('đã lưu (hết dirty) -> đi thẳng; chỉ đổi query cùng trang -> không chặn', () => {
    const router = setup();
    click('query');
    expect(router.state.location.search).toBe('?page=2');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click('save');
    click('go');
    expect(router.state.location.pathname).toBe('/other');
  });

  it('Modal dirty -> Back trình duyệt (POP) cũng bị chặn', async () => {
    const router = setup('/other');
    await act(() => router.navigate('/modal'));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/modal');
    expect(dialogTitle()).toBe(i18n.t('discard.title', { ns: 'common' }));
    // B-1: Bỏ thay đổi -> modal trang + hộp xác nhận unmount cùng lúc -> body phải cuộn lại được
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => buttonByText(i18n.t('discard.confirm', { ns: 'common' })).click());
    expect(router.state.location.pathname).toBe('/other');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
