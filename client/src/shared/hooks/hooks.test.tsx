// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { useLoad, type LoadState } from './useLoad';
import { useUrlSearch, useUrlState } from './useUrlState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
function mount(el: JSX.Element) {
  root = createRoot(document.createElement('div'));
  act(() => root!.render(el));
}

describe('useLoad (UX-5)', () => {
  it('bỏ qua response cũ về muộn; lỗi giữ data cũ; reload tải lại', async () => {
    const pending: Record<string, { resolve: (v: string) => void; reject: (e: unknown) => void }> = {};
    const fetcher = (q: string) =>
      new Promise<string>((resolve, reject) => {
        pending[q] = { resolve, reject };
      });
    let st!: LoadState<string>;
    function C({ q }: { q: string }) {
      st = useLoad(() => fetcher(q), [q]);
      return null;
    }
    mount(<C q="an" />);
    act(() => root!.render(<C q="anh" />));
    await act(async () => pending.anh.resolve('anh-result'));
    await act(async () => pending.an.resolve('an-result')); // về muộn -> bỏ qua
    expect(st.data).toBe('anh-result');
    expect(st.loading).toBe(false);

    act(() => st.reload());
    expect(st.loading).toBe(true);
    expect(st.data).toBe('anh-result'); // giữ data cũ trong lúc tải lại
    await act(async () => pending.anh.reject(new Error('net')));
    expect(st.error).toBeInstanceOf(Error);
    expect(st.data).toBe('anh-result');
  });
});

describe('useUrlState (UX-6)', () => {
  it('đọc default, merge param khác, xóa key bằng default, replace', () => {
    let st!: Record<string, string>;
    let set!: (p: Record<string, string>) => void;
    let search = '';
    function C() {
      [st, set] = useUrlState({ search: '', status: '', page: '1' });
      const loc = useLocation();
      useEffect(() => {
        search = loc.search;
      });
      return null;
    }
    mount(
      <MemoryRouter initialEntries={['/x?tab=inv&page=3']}>
        <C />
      </MemoryRouter>
    );
    expect(st).toEqual({ search: '', status: '', page: '3' });
    act(() => set({ status: 'paused', page: '1' }));
    expect(st).toEqual({ search: '', status: 'paused', page: '1' });
    expect(new URLSearchParams(search).toString()).toBe('tab=inv&status=paused');
  });
});

describe('useUrlSearch (B-2)', () => {
  it('gõ giữa chuỗi: giữ giá trị + con trỏ; URL chỉ đổi sau debounce; Back đồng bộ ngược vào ô', async () => {
    vi.useFakeTimers();
    try {
      function Page() {
        const [q, setQ] = useUrlState({ search: '', page: '1' });
        const [text, setText] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }));
        return <input id="s" value={text} onChange={(e) => setText(e.target.value)} />;
      }
      const router = createMemoryRouter([{ path: '/x', element: <Page /> }], {
        initialEntries: ['/x', '/x?search=Nguyen&page=2'],
      });
      const el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      act(() => root!.render(<RouterProvider router={router} />));
      const input = document.getElementById('s') as HTMLInputElement;
      expect(input.value).toBe('Nguyen');

      // Gõ "X" sau "Ngu" như trình duyệt: đổi value native, đặt caret, bắn sự kiện input
      const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setNative.call(input, 'NguXyen');
        input.setSelectionRange(4, 4);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(input.value).toBe('NguXyen');
      expect(input.selectionStart).toBe(4);
      expect(router.state.location.search).toBe('?search=Nguyen&page=2'); // chưa debounce

      await act(async () => vi.advanceTimersByTime(400));
      expect(new URLSearchParams(router.state.location.search).get('search')).toBe('NguXyen');
      expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull(); // về trang 1
      expect(input.value).toBe('NguXyen');
      expect(input.selectionStart).toBe(4);

      // Back (đổi URL từ ngoài) -> ô hiện lại giá trị của URL
      await act(async () => router.navigate(-1));
      expect(input.value).toBe('');
      await act(async () => vi.advanceTimersByTime(400));
      expect(router.state.location.search).toBe(''); // không ghi đè ngược lên URL
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = '';
    }
  });
});
