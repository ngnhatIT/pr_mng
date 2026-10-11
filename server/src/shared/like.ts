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

/**
 * Điều kiện tìm kiếm không dấu + không phân biệt hoa thường trên nhiều cột (hàm SQL f_unaccent, migration v29).
 *   const { sql, params } = searchCond(['s.name', 's.code'], search);  // "(f_unaccent(s.name) LIKE ... OR ...)"
 * Tên cột do code truyền vào (không bao giờ từ input người dùng).
 */
export function searchCond(cols: string[], search: string): { sql: string; params: string[] } {
  const kw = `%${escapeLike(search.trim())}%`;
  return {
    sql: `(${cols.map((c) => `f_unaccent(${c}) LIKE f_unaccent(?) ESCAPE '\\'`).join(' OR ')})`,
    params: cols.map(() => kw),
  };
}
