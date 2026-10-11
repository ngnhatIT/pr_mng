// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Menu } from './Menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('Menu', () => {
  it('mở focus mục đầu, ↑/↓ xoay vòng bỏ qua mục disabled, Esc đóng và trả focus, chọn thì gọi onSelect', () => {
    const onEdit = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    act(() => {
      root = createRoot(el);
      root.render(
        <Menu
          label="Thao tác"
          items={[
            { label: 'Sửa', onSelect: onEdit },
            { label: 'Khóa', onSelect: vi.fn(), disabled: true },
            { label: 'Xóa', onSelect: vi.fn(), danger: true },
          ]}
        />
      );
    });
    const btn = el.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    act(() => btn.click());
    const menu = document.querySelector('[role="menu"]')!;
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Sửa');

    key(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Xóa'); // bỏ qua "Khóa" (disabled)
    key(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Sửa'); // xoay vòng

    key(menu, 'Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(btn);

    act(() => btn.click());
    act(() => (document.querySelector('[role="menuitem"]') as HTMLElement).click());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
