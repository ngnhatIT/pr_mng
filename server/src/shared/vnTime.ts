/**
 * Thời gian hiện tại theo giờ Việt Nam, định dạng SQL 'YYYY-MM-DD HH:mm:ss'.
 * Dùng khi ghi timestamp vào DB từ JS (thay vì new Date().toISOString() là UTC).
 */
export function nowVNSql(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', ' ');
}

/**
 * Ngày hiện tại theo giờ Việt Nam, định dạng 'YYYY-MM-DD'.
 */
export function todayVN(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 10);
}
