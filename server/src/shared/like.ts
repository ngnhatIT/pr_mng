/**
 * Escape ký tự wildcard trong LIKE (`%`, `_`, `\`).
 * Dùng cho mọi search input của user để `%` không match toàn bộ DB.
 *
 * Ví dụ: escapeLike('100%') → '100\\%'
 * Query: `WHERE name LIKE ? ESCAPE '\\'` với param `%${escapeLike(search)}%`
 */
export function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
