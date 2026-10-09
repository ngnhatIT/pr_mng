/** Tiện ích ngày tháng & lịch học — hàm thuần, không chạm DB. */

export interface ScheduleEntry {
  day: number; // 2 = Thứ Hai ... 7 = Thứ Bảy, 8 = Chủ Nhật
  start: string; // "18:00"
  end: string; // "20:00"
}

export interface ClassRow {
  id: number;
  name: string;
  teacher_id: number | null;
  schedule: string;
  start_date: string | null;
  end_date: string | null;
  tuition_fee: number;
  max_students: number;
  status: string;
}

/* ------------------------------ Tiện ích ngày ------------------------------ */

/** Múi giờ nghiệp vụ: mọi "hôm nay", "tháng này" đều theo giờ Việt Nam. */
export const VN_TZ = 'Asia/Ho_Chi_Minh';

/**
 * Ngày YYYY-MM-DD theo giờ Việt Nam (không phụ thuộc TZ của server).
 * Server thường chạy UTC — dùng getFullYear() thuần sẽ sai ngày từ 00:00-06:59 giờ VN.
 */
export function toISODate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA cho ra YYYY-MM-DD
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Chuyển JS getDay() (0=CN..6=T7) sang quy ước của app (2=T2..8=CN) */
export function ourDayOfWeek(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 8 : js + 1;
}

export const DAY_NAMES: Record<number, string> = {
  2: 'Thứ Hai',
  3: 'Thứ Ba',
  4: 'Thứ Tư',
  5: 'Thứ Năm',
  6: 'Thứ Sáu',
  7: 'Thứ Bảy',
  8: 'Chủ Nhật',
};

export function formatSchedule(scheduleJson: string): string {
  try {
    const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
    return s.map((e) => `${DAY_NAMES[e.day] || ''} ${e.start}-${e.end}`).join(', ');
  } catch {
    return '';
  }
}
