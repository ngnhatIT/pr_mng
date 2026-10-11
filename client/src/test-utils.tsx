// Tiện ích cho test DOM (file test khai báo `// @vitest-environment happy-dom`):
// giả fetch theo route (đi qua api modules + client thật -> kiểm được request shape) và render qua router.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { vi } from 'vitest';
import { ToastProvider } from './shared/ui/toast';
import { clearAuth } from './shared/api/client';
import i18n from './i18n';

// happy-dom báo navigator 'en': cố định tiếng Việt (ngôn ngữ mặc định của app) cho assert text/định dạng tiền
await i18n.changeLanguage('vi');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Modal tìm phần tử focus được qua getClientRects (happy-dom không layout)
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

export type Call = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
};
type Handler = unknown | ((call: Call) => unknown);

/**
 * Giả fetch. Key dạng 'GET /students' khớp method + path (bỏ /api/v1 và query).
 * Handler là JSON trả về, hoặc hàm (call) => JSON | Response. Route không khai báo -> 404.
 * Trả mảng calls để assert request đã gửi.
 */
export function mockFetch(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://x');
      const method = (init.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const headers = (init.headers ?? {}) as Record<string, string>;
      const call = { method, path, query: url.searchParams, body, headers };
      calls.push(call);
      const h = routes[`${method} ${path}`];
      if (h === undefined) return json(404, { error: `not mocked: ${method} ${path}` });
      const v = typeof h === 'function' ? (h as (c: Call) => unknown)(call) : h;
      return v instanceof Response ? v : json(200, v);
    })
  );
  return calls;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let root: Root | null = null;

/** Render `routes` (bọc ToastProvider) tại `at`; trả router để đọc location sau điều hướng. */
export async function renderRoutes(routes: RouteObject[], at: string) {
  const router = createMemoryRouter(routes, { initialEntries: [at] });
  // B5-6: window.location đi theo router như production (client.ts đọc window.location.pathname để chọn trang
  // login của portal và lưu deep-link edu_next)
  const syncUrl = ({ pathname, search, hash }: { pathname: string; search: string; hash: string }) =>
    history.replaceState(null, '', pathname + search + hash);
  syncUrl(router.state.location);
  router.subscribe((s) => syncUrl(s.location));
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    root = createRoot(el);
    root.render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );
  });
  await flush();
  return router;
}

export const renderPage = (element: ReactElement, at = '/') => renderRoutes([{ path: '*', element }], at);

/** Chờ các promise (fetch giả, lazy chunk) resolve và React render xong. */
export async function flush(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export function cleanup() {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  clearAuth();
  history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
}

export const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

/** Phần tử (mặc định button) có text chứa `text`. */
export function byText<T extends HTMLElement = HTMLElement>(text: string, sel = 'button'): T {
  const el = $$<T>(sel).find((e) => e.textContent?.includes(text));
  if (!el) throw new Error(`Không thấy <${sel}> chứa "${text}"`);
  return el;
}

export async function click(el: Element | null) {
  if (!el) throw new Error('click: element null');
  await act(async () => (el as HTMLElement).click());
  await flush(3);
}

/** Gõ vào input/textarea/select do React điều khiển (đổi value native rồi bắn event). */
export async function type(el: Element | null, value: string) {
  if (!el) throw new Error('type: element null');
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
