import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { STUDENT_STATUS, nextStudentCode } from './students.service';

export const MAX_IMPORT_ROWS = 2000;

const FIELDS = ['code', 'name', 'phone', 'email', 'dob', 'address', 'status', 'note'] as const;
type Field = (typeof FIELDS)[number];
export type ImportRow = Partial<Record<Field, unknown>>;

const MAX_LEN: Record<Field, number> = {
  code: 20,
  name: 100,
  phone: 20,
  email: 100,
  dob: 10,
  address: 255,
  status: 20,
  note: 500,
};

/** Mã lỗi (client dịch theo mã): required | too_long | invalid_email | invalid_date | invalid_status | duplicate_in_file | code_exists */
export interface ImportError {
  row: number;
  field: Field;
  code: string;
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Chuẩn hóa + kiểm tra 1 dòng (row = số dòng trong file, tính cả dòng tiêu đề -> dòng dữ liệu đầu là 2). */
function checkRow(raw: ImportRow, row: number, errors: ImportError[]): Record<Field, string> {
  const v = {} as Record<Field, string>;
  for (const f of FIELDS) {
    v[f] = raw[f] == null ? '' : String(raw[f]).trim();
    if (v[f].length > MAX_LEN[f]) errors.push({ row, field: f, code: 'too_long' });
  }
  if (!v.name) errors.push({ row, field: 'name', code: 'required' });
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
    errors.push({ row, field: 'email', code: 'invalid_email' });
  if (v.dob && !isRealDate(v.dob)) errors.push({ row, field: 'dob', code: 'invalid_date' });
  if (v.status && !(STUDENT_STATUS as readonly string[]).includes(v.status)) {
    errors.push({ row, field: 'status', code: 'invalid_status' });
  }
  return v;
}

/**
 * Nhập học viên hàng loạt. dryRun: chỉ kiểm tra. Nhập thật: chỉ thêm dòng hợp lệ (trong 1 transaction),
 * dòng lỗi bỏ qua và trả về trong errors. Mã để trống -> tự sinh HVxxxx như tạo tay.
 */
export async function importStudents(
  centerId: number,
  rows: ImportRow[],
  opts: { dryRun: boolean; actor?: AuditActor }
): Promise<{ total: number; valid: number; created: number; errors: ImportError[] }> {
  if (!Array.isArray(rows) || rows.length === 0)
    throw AppError.badRequest('File không có dòng dữ liệu', 'IMPORT_EMPTY');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw AppError.badRequest(`Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`, 'IMPORT_TOO_LARGE');
  }
  const errors: ImportError[] = [];
  const checked = rows.map((r, i) => checkRow(r ?? {}, i + 2, errors));

  const codes = checked.map((r) => r.code).filter(Boolean);
  const seen = new Map<string, number>();
  checked.forEach((r, i) => {
    if (!r.code) return;
    if (seen.has(r.code)) errors.push({ row: i + 2, field: 'code', code: 'duplicate_in_file' });
    else seen.set(r.code, i);
  });
  if (codes.length) {
    const existing = (await db
      .prepare('SELECT code FROM students WHERE center_id = ? AND code = ANY(?::text[])')
      .all(centerId, codes)) as { code: string }[];
    const taken = new Set(existing.map((e) => e.code));
    checked.forEach((r, i) => {
      if (r.code && taken.has(r.code)) errors.push({ row: i + 2, field: 'code', code: 'code_exists' });
    });
  }
  errors.sort((a, b) => a.row - b.row);
  const bad = new Set(errors.map((e) => e.row));
  const good = checked.filter((_, i) => !bad.has(i + 2));
  const result = { total: rows.length, valid: good.length, created: 0, errors };
  if (opts.dryRun || !good.length) return result;

  await db.transaction(async (tx) => {
    // Dòng có mã tay trước: mã tự sinh (MAX+1) tính cả chúng, không đụng mã tay xuất hiện sau trong file
    const ordered = [...good.filter((r) => r.code), ...good.filter((r) => !r.code)];
    for (const r of ordered) {
      await tx
        .prepare(
          'INSERT INTO students (code, name, phone, email, dob, address, status, note, center_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          r.code || (await nextStudentCode(tx, centerId)),
          r.name,
          r.phone || null,
          r.email || null,
          r.dob || null,
          r.address || null,
          r.status || 'studying',
          r.note || null,
          centerId
        );
    }
  });
  await audit({
    centerId,
    actor: opts.actor,
    action: 'create',
    entity: 'students',
    summary: `Nhập ${good.length} học viên từ file (bỏ qua ${rows.length - good.length} dòng lỗi)`,
    meta: { created: good.length, skipped: rows.length - good.length },
  });
  return { ...result, created: good.length };
}
