import { describe, it, expect } from 'vitest';
import en from './locales/en/common.json';
import vi from './locales/vi/common.json';

// Mã lỗi server -> client dịch theo mã (toastApiError). Quét mã nguồn server để mã mới không quên bản dịch.
const sources = import.meta.glob('../../../server/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function serverCodes(): string[] {
  const codes = new Set<string>();
  for (const [file, s] of Object.entries(sources)) {
    if (file.includes('.test.')) continue;
    for (const m of s.matchAll(
      /AppError(?:\.[a-zA-Z]+)?\((?:[^()]|\([^()]*\))*?,\s*'([A-Z][A-Z0-9_]+)'\s*\)/gs
    ))
      codes.add(m[1]);
    for (const m of s.matchAll(/code: '([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe('mã lỗi API có bản dịch', () => {
  it('mọi mã lỗi server có trong api.errors của vi và en', () => {
    const codes = serverCodes();
    expect(codes.length).toBeGreaterThan(40);
    const errs = (o: unknown) => (o as { api: { errors: Record<string, string> } }).api.errors;
    expect(codes.filter((c) => !errs(en)[c])).toEqual([]);
    expect(codes.filter((c) => !errs(vi)[c])).toEqual([]);
  });
});
