import { headerKey, parseCsv } from '../../shared/csv';

export const IMPORT_FIELDS = ['code', 'name', 'phone', 'email', 'dob', 'address', 'status', 'note'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>>;

/** Tiêu đề chấp nhận: tên cột tiếng Anh + tiêu đề tiếng Việt/Anh của file Xuất CSV (xuất ra nhập lại được). */
const ALIASES: Record<string, ImportField> = Object.fromEntries(
  (
    [
      ['code', ['code', 'mahv', 'mahocvien', 'studentcode']],
      ['name', ['name', 'hoten', 'ten', 'fullname', 'tenhocvien']],
      ['phone', ['phone', 'dienthoai', 'sodienthoai', 'sdt']],
      ['email', ['email']],
      ['dob', ['dob', 'ngaysinh', 'dateofbirth', 'birthday']],
      ['address', ['address', 'diachi']],
      ['status', ['status', 'trangthai']],
      ['note', ['note', 'ghichu', 'notes']],
    ] as [ImportField, string[]][]
  ).flatMap(([f, keys]) => keys.map((k) => [k, f]))
);

const STATUS: Record<string, string> = {
  studying: 'studying',
  danghoc: 'studying',
  paused: 'paused',
  tamnghi: 'paused',
  baoluu: 'paused',
  quit: 'quit',
  danghi: 'quit',
};

/** DD/MM/YYYY hoặc D/M/YYYY (Excel VN) -> YYYY-MM-DD; giữ nguyên dạng khác để server báo lỗi đúng dòng. */
function normDate(v: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim();
}

/** CSV -> dòng cho API nhập; cột không nhận ra bị bỏ qua (trả về để báo người dùng). */
export function rowsFromCsv(text: string): { rows: ImportRow[]; unknownColumns: string[]; hasName: boolean } {
  const [header = [], ...data] = parseCsv(text);
  const map = header.map((h) => ALIASES[headerKey(h)] ?? null);
  const rows = data.map((cells) => {
    const r: ImportRow = {};
    map.forEach((f, i) => {
      const v = (cells[i] ?? '').trim();
      if (!f || !v) return;
      r[f] = f === 'dob' ? normDate(v) : f === 'status' ? (STATUS[headerKey(v)] ?? v) : v;
    });
    return r;
  });
  return {
    rows,
    unknownColumns: header
      .filter((_, i) => !map[i])
      .map((h) => h.trim())
      .filter(Boolean),
    hasName: map.includes('name'),
  };
}

export const TEMPLATE_CSV = `﻿${IMPORT_FIELDS.join(',')}\r\n,Nguyễn Văn A,0901234567,a@example.com,15/08/2012,"12 Lê Lợi, Q1",studying,\r\n`;
