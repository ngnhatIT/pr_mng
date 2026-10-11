import { describe, it, expect, vi } from 'vitest';
import { reloadOnceOnChunkError } from './ErrorBoundary';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('reloadOnceOnChunkError (FE-2)', () => {
  const chunkErr = new TypeError('Failed to fetch dynamically imported module: /assets/Payroll-old.js');

  it('lỗi chunk -> reload 1 lần, lần 2 liền sau thì không (chống loop)', () => {
    const s = mem();
    const reload = vi.fn();
    expect(reloadOnceOnChunkError(chunkErr, s, reload, 1_000_000)).toBe(true);
    expect(reloadOnceOnChunkError(chunkErr, s, reload, 1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // deploy sau đó (quá 60s) vẫn tự phục hồi được
    expect(reloadOnceOnChunkError(chunkErr, s, reload, 1_100_000)).toBe(true);
  });

  it('lỗi thường -> không reload', () => {
    const reload = vi.fn();
    expect(reloadOnceOnChunkError(new Error('boom'), mem(), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
