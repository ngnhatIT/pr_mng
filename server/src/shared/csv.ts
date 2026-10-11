import type { Response } from 'express';
import type { Paginated } from './pagination';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** RFC 4180 + chặn CSV/formula injection (ô bắt đầu bằng = + - @ tab CR bị Excel coi là công thức). */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  return lines.join('\r\n');
}

/** BOM để Excel mở UTF-8 (tiếng Việt) đúng font. */
export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('﻿' + csv);
}

/**
 * Gom mọi trang của 1 hàm list có phân trang (tái dùng nguyên filter/scope của service).
 * ponytail: N query cho N trang (100 dòng/trang), cap MAX_EXPORT_ROWS; cần stream/cursor nếu trung tâm > vài chục nghìn dòng.
 */
export const MAX_EXPORT_ROWS = 20000;
export async function collectAll<T>(fetchPage: (page: number) => Promise<Paginated<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const { data, pagination } = await fetchPage(page);
    out.push(...data);
    if (page >= pagination.totalPages || out.length >= MAX_EXPORT_ROWS) return out.slice(0, MAX_EXPORT_ROWS);
  }
}
