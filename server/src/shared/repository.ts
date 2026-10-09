import { db } from '../db';
import { AppError } from './errors';

/**
 * Repository dùng chung — common hoá pattern "tìm theo id + kiểm tra center scope"
 * lặp đi lặp lại khắp các modules.
 *
 * Thay vì mỗi route viết 5 dòng:
 *   const cur = db.prepare('SELECT center_id FROM students WHERE id = ?').get(id);
 *   if (!cur || (cid !== null && cur.center_id !== cid)) throw AppError.notFound(...);
 *
 * Chỉ cần 1 dòng:
 *   const student = findByIdOr404('students', id, cid, 'Không tìm thấy học viên');
 */

const SCOPED_TABLES = [
  'students',
  'teachers',
  'classes',
  'invoices',
  'rooms',
  'leads',
  'trial_registrations',
  'referrals',
  'reviews',
] as const;

export type ScopedTable = (typeof SCOPED_TABLES)[number];

export interface ScopedRow {
  id: number;
  center_id: number | null;
  [key: string]: unknown;
}

/**
 * Tìm 1 dòng theo id, kiểm tra thuộc center hiện tại.
 * - Không tìm thấy hoặc khác center -> ném 404 (tránh lộ sự tồn tại của dữ liệu)
 * - centerId = null (superadmin) -> bỏ qua kiểm tra center
 */
export function findByIdOr404<T extends ScopedRow = ScopedRow>(
  table: ScopedTable,
  id: number,
  centerId: number | null,
  notFoundMessage = 'Không tìm thấy dữ liệu'
): T {
  // Guard runtime: tên bảng nội suy vào SQL nên phải nằm trong allowlist
  if (!(SCOPED_TABLES as readonly string[]).includes(table)) {
    throw AppError.badRequest('Bảng dữ liệu không hợp lệ');
  }
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
  if (!row || (centerId !== null && row.center_id !== centerId)) {
    throw AppError.notFound(notFoundMessage);
  }
  return row;
}

/**
 * Kiểm tra 1 dòng có thuộc center không (không ném lỗi, trả boolean).
 * Dùng khi cần xử lý khác nhau thay vì 404 ngay.
 */
export function belongsToCenter(
  row: { center_id: number | null } | undefined,
  centerId: number | null
): boolean {
  if (!row) return false;
  if (centerId === null) return true; // superadmin
  return row.center_id === centerId;
}

/** Xóa mềm/mạnh 1 dòng sau khi đã kiểm tra scope. Trả về true nếu đã xóa. */
export function deleteById(table: ScopedTable, id: number): boolean {
  const r = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return r.changes > 0;
}
