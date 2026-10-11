// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { $$, cleanup, click, renderPage } from '../../test-utils';
import { useToast } from './toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let push: ReturnType<typeof useToast>;
function Grab() {
  const toast = useToast();
  useEffect(() => {
    push = toast;
  }, [toast]);
  return null;
}

describe('ToastProvider', () => {
  it('B4-4: toast giống hệt trong 2s chỉ hiện 1 lần; khác type/message hoặc sau 2s thì hiện', async () => {
    await renderPage(<Grab />);
    vi.useFakeTimers();
    act(() => {
      push('Phiên hết hạn', 'error');
      push('Phiên hết hạn', 'error');
      push('Phiên hết hạn', 'info');
      push('Lỗi khác', 'error');
    });
    expect($$('.toast').map((e) => e.textContent)).toEqual(['Phiên hết hạn', 'Phiên hết hạn', 'Lỗi khác']);
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    act(() => push('Phiên hết hạn', 'error'));
    expect($$('.toast-error')).toHaveLength(3);
  });

  it('tự ẩn (error 6s, còn lại 3.2s) và đóng tay được', async () => {
    await renderPage(<Grab />);
    vi.useFakeTimers();
    act(() => {
      push('ok', 'success');
      push('bad', 'error');
    });
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect($$('.toast').map((e) => e.textContent)).toEqual(['bad']);
    vi.useRealTimers();
    await click($$('.toast-close')[0]);
    expect($$('.toast')).toHaveLength(0);
  });
});
