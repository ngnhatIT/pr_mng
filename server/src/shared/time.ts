/** Hằng số thời gian dùng chung — tránh magic number rải rác. */

/** 1 ngày tính bằng milliseconds. */
export const DAY_MS = 86_400_000;

/** Cộng/trừ n ngày vào một Date, trả về Date mới (không mutate). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Hôm nay dạng YYYY-MM-DD (giờ địa phương của server). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
