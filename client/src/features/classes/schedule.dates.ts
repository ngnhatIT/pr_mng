/** Phép tính ngày cho trang Lịch trên chuỗi YYYY-MM-DD (UTC thuần, không lệch múi giờ). */

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysIso(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Thứ Hai của tuần chứa ngày iso (tuần bắt đầu thứ Hai như lịch VN/ISO-8601). */
export function startOfWeek(iso: string): string {
  const dow = (toDate(iso).getUTCDay() + 6) % 7; // 0 = T2
  return addDaysIso(iso, -dow);
}

export function weekRange(iso: string): { from: string; to: string } {
  const from = startOfWeek(iso);
  return { from, to: addDaysIso(from, 6) };
}

/** Lưới tháng: từ thứ Hai trước ngày 1 tới Chủ Nhật sau ngày cuối (35 hoặc 42 ngày). */
export function monthGridRange(iso: string): { from: string; to: string } {
  const first = `${iso.slice(0, 7)}-01`;
  const d = toDate(first);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  const last = toIso(d);
  return { from: startOfWeek(first), to: addDaysIso(startOfWeek(last), 6) };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Ngày tương ứng khi bấm trước/sau: tuần ±7 ngày, tháng ±1 tháng (về ngày 1). */
export function shiftAnchor(iso: string, view: 'week' | 'month', dir: 1 | -1): string {
  if (view === 'week') return addDaysIso(iso, 7 * dir);
  const d = toDate(`${iso.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return toIso(d);
}
