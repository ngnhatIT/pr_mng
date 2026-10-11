// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from './Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// getFocusables lọc theo getClientRects (element đang hiển thị); DOM giả không layout -> coi như mọi element đều hiện.
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

function Harness({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Modal
          title="T"
          dirty={dirty}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <input id="first" />
        </Modal>
      )}
    </>
  );
}

function render(dirty?: boolean) {
  act(() => root.render(<Harness dirty={dirty} />));
  const opener = document.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  act(() => opener.click());
}

function esc(init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ...init }));
  });
}

const dialogs = () => document.querySelectorAll('[role="dialog"]');

beforeEach(() => {
  onClose.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Modal', () => {
  it('UX-1: mở modal focus field đầu tiên trong body, không phải nút X', () => {
    render();
    expect(document.activeElement?.id).toBe('first');
  });

  it('Esc đóng modal và trả focus về nút đã mở', () => {
    render();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('UX-11: Esc khi đang gõ IME (isComposing) không đóng modal', () => {
    render();
    esc({ isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);
  });

  it('UX-4: modal dirty -> Esc hỏi xác nhận; Esc lần 2 chỉ đóng hộp xác nhận; xác nhận mới đóng', () => {
    render(true);
    esc();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(2);
    // Hộp xác nhận nằm trên cùng: Esc chỉ đóng nó, modal form còn nguyên
    esc();
    expect(dialogs()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    // Bấm X -> hỏi lại -> bấm nút xác nhận (nút cuối của hộp xác nhận)
    act(() => (document.querySelector('.modal-close') as HTMLButtonElement).click());
    const confirmBtn = dialogs()[1].querySelector('.btn-danger') as HTMLButtonElement;
    act(() => confirmBtn.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it('B-1: modal dirty + hộp xác nhận đóng cùng 1 commit -> mở khóa scroll body', () => {
    render(true);
    expect(document.body.style.overflow).toBe('hidden');
    esc();
    expect(dialogs()).toHaveLength(2);
    act(() => (dialogs()[1].querySelector('.btn-danger') as HTMLButtonElement).click());
    expect(dialogs()).toHaveLength(0);
    expect(document.body.style.overflow).toBe('');
  });

  it('click trong modal không đóng; click đúng nền thì đóng', () => {
    render();
    const input = document.getElementById('first')!;
    act(() => {
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      document
        .querySelector('.modal-backdrop')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
