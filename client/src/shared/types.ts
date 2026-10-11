// Lưu ý: import i18n (leaf module, chỉ chứa JSON + i18next) để format theo ngôn ngữ hiện tại.
// i18n/index.ts không import ngược types.ts nên không có circular import.
import i18n from '../i18n';

export interface User {
  id: number;
  username: string;
  role: string;
  name: string;
}

export interface Student {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  address: string | null;
  status: 'studying' | 'paused' | 'quit';
  note: string | null;
  created_at: string;
}

export interface Teacher {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  class_count?: number;
  created_at: string;
}

export interface ScheduleEntry {
  day: number; // 2 = Thứ Hai ... 8 = Chủ Nhật
  start: string;
  end: string;
}

export interface ClassItem {
  id: number;
  name: string;
  teacher_id: number | null;
  teacher_name: string | null;
  room_id?: number | null;
  room_name?: string | null;
  schedule: string;
  start_date: string | null;
  end_date: string | null;
  tuition_fee: number;
  max_students: number;
  status: 'active' | 'inactive';
  student_count?: number;
}

export interface SessionItem {
  id: number;
  class_id: number;
  date: string;
  topic: string | null;
  attendance_count?: number;
}

export interface AttendanceRow {
  id: number;
  code: string;
  name: string;
  status: string | null;
  note: string | null;
}

export interface InvoiceItem {
  id: number;
  student_id: number;
  class_id: number | null;
  amount: number;
  due_date: string | null;
  status: 'unpaid' | 'partial' | 'paid';
  note: string | null;
  created_at: string;
  student_name?: string;
  student_code?: string;
  class_name?: string | null;
  paid?: number;
  /** v28: kỳ thu YYYY-MM */
  period?: string | null;
  discount_amount?: number;
  discount_reason?: string | null;
}

/** v28: dòng hóa đơn (amount của hóa đơn = tổng dòng - giảm trừ). */
export interface InvoiceLine {
  id?: number;
  description: string;
  quantity: number;
  unit_price: number;
}

/** Số tiền còn nợ của hóa đơn: amount − paid (paid thiếu/null coi như 0). Dùng chung mọi màn hình. */
export function remainingOf(invoice: { amount: number; paid?: number | null }): number {
  return invoice.amount - (invoice.paid || 0);
}

export interface DebtRow {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  total: number;
  paid: number;
  debt: number;
  /** "id:due_date,id:due_date..." các hóa đơn chưa thanh toán đủ */
  invoice_dues?: string | null;
}

export interface RemindResult {
  demo: boolean;
  status: 'sent' | 'failed' | 'demo';
  message: string;
  phone: string | null;
}

export interface TodaySession {
  id: number;
  date: string;
  topic: string | null;
  class_id: number;
  class_name: string;
  teacher_name: string | null;
  room_name?: string | null;
  /** JSON lịch tuần của lớp: dùng lấy giờ học của riêng hôm nay. */
  schedule?: string;
  scheduleText: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface DashboardData {
  totalStudents: number;
  studyingStudents: number;
  totalTeachers: number;
  activeClasses: number;
  revenueThisMonth: number;
  unpaidTotal: number;
  todaySessions: TodaySession[];
  /** 6 tháng liên tiếp, cũ -> mới; rỗng khi tài khoản không xem tài chính. */
  revenueByMonth?: { month: string; total: number }[];
}

export interface ZaloConfig {
  zalo_oa_id: string;
  zalo_access_token: string;
  zalo_template_overdue: string;
  zalo_template_upcoming: string;
  zalo_enabled: string;
  center_name: string;
  reminder_hour: string;
  reminder_overdue_days: string;
  reminder_upcoming_days: string;
}

export interface ReminderItem {
  id: number;
  invoice_id: number | null;
  student_id: number | null;
  phone: string | null;
  kind: 'overdue' | 'upcoming' | 'test';
  status: 'sent' | 'failed' | 'demo';
  message: string | null;
  response: string | null;
  created_at: string;
  student_name: string | null;
  student_code: string | null;
  invoice_amount: number | null;
  due_date: string | null;
}

/**
 * Tên các ngày trong tuần theo ngôn ngữ hiện tại của app (2 = Thứ Hai ... 8 = Chủ Nhật).
 * Dùng Intl.DateTimeFormat thay vì hard-code để tự theo locale người dùng.
 */
export function getDayNames(locale?: string): Record<number, string> {
  const lang = locale ?? i18n.language;
  const fmt = new Intl.DateTimeFormat(appLocale(lang), { weekday: 'long' });
  const names: Record<number, string> = {};
  for (let day = 2; day <= 8; day++) {
    // 12/10/2026 là Thứ Hai -> day 2..8 ứng với 12..18/10/2026
    names[day] = fmt.format(new Date(2026, 9, 10 + day));
  }
  return names;
}

/**
 * Format tiền VND theo ngôn ngữ hiện tại của app.
 * - vi: "1.000.000đ" (toLocaleString vi-VN)
 * - en: "1,000,000 VND" (toLocaleString en-US)
 * Có thể truyền locale tường minh để override (hữu ích cho test).
 */
/** "Nguyễn Văn An" -> "NA": chữ đầu của họ + tên gọi, cho avatar chữ cái. */
export function initials(name?: string | null) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

export function formatVND(n: number, locale?: string): string {
  const lang = locale ?? i18n.language;
  if (lang === 'en') {
    return `${Math.round(n).toLocaleString('en-US')} VND`;
  }
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/** Locale Intl theo ngôn ngữ app. */
export function appLocale(lang: string = i18n.language): string {
  return lang === 'en' ? 'en-US' : 'vi-VN';
}

/** vi: "09/10/2026"; en: "Oct 9, 2026" (DD/MM với người đọc tiếng Anh dễ hiểu nhầm thành MM/DD). */
export function formatDate(iso: string | null, locale?: string): string {
  if (!iso) return '-';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if ((locale ?? i18n.language) !== 'en' || !y || !m || !day) return `${day}/${m}/${y}`;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(+y, +m - 1, +day))
  );
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7, không DST), dạng YYYY-MM-DD.
 * Dùng cho min của input date và so sánh hạn thay vì new Date().toISOString()
 * (UTC) để không bị lệch 1 ngày trong khung 0:00-7:00 giờ VN. */
export function todayVN(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** Thời điểm hiện tại theo giờ VN cho input datetime-local (YYYY-MM-DDTHH:MM).
 * VN không có DST nên cộng thẳng 7 giờ là đúng quanh năm. */
export function nowVN(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16);
}

/** Đã qua hạn chót cứng theo giờ VN chưa? So sánh chuỗi YYYY-MM-DD với todayVN(),
 * khớp đúng logic chặn nộp của server (submitQuiz/submitHomework). */
export function isPastCloseDate(closeDate: string | null | undefined): boolean {
  return closeDate != null && closeDate < todayVN();
}

/** Định dạng ngày giờ đầy đủ: "08/10/2026 14:30" */
export function formatDateTime(iso: string | null, locale?: string): string {
  if (!iso) return '-';
  const time = iso.slice(11, 16);
  return `${formatDate(iso, locale)}${time ? ` ${time}` : ''}`;
}

/** Giờ thực của 1 buổi: giờ riêng (dời/đổi giờ, v26) nếu có, không thì theo lịch tuần của lớp. */
export function sessionSlot(s: {
  schedule?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
}): ScheduleEntry | null {
  return s.start_time && s.end_time
    ? { day: 0, start: s.start_time, end: s.end_time }
    : slotOn(s.schedule, s.date);
}

/** Khung giờ của lớp vào đúng ngày `date` (YYYY-MM-DD) theo lịch tuần JSON; null nếu hôm đó không có. */
export function slotOn(scheduleJson: string | null | undefined, date: string): ScheduleEntry | null {
  try {
    const js = new Date(`${date}T00:00:00`).getDay();
    const dow = js === 0 ? 8 : js + 1; // quy ước app: 2 = T2 ... 8 = CN
    return (JSON.parse(scheduleJson || '[]') as ScheduleEntry[]).find((x) => x.day === dow) ?? null;
  } catch {
    return null;
  }
}

/** Tên thứ ngắn: vi "T2".."T7", "CN"; en theo Intl ("Mon"). */
export function shortDayName(day: number, locale?: string): string {
  const lang = locale ?? i18n.language;
  if (lang !== 'en') return day === 8 ? 'CN' : `T${day}`;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(2026, 9, 10 + day));
}

/**
 * Lịch tuần gọn: gộp các ngày cùng khung giờ -> "T2, T4, T6 19:30-21:00" thay vì lặp giờ cho từng ngày
 * (lặp làm thẻ lớp xuống 3 dòng và lệch chiều cao). Khung giờ khác nhau ngăn bằng " · ".
 */
export function formatScheduleText(scheduleJson: string, locale?: string): string {
  try {
    const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
    const groups = new Map<string, number[]>();
    for (const e of s) {
      const key = `${e.start}-${e.end}`;
      groups.set(key, [...(groups.get(key) ?? []), e.day]);
    }
    return [...groups.entries()]
      .map(([time, days]) => `${days.map((d) => shortDayName(d, locale)).join(', ')} ${time}`)
      .join(' · ');
  } catch {
    return '';
  }
}

/* ============================ Mới: cổng phụ huynh / giáo viên / tuyển sinh ============================ */

export interface ParentUser {
  id: number;
  phone: string;
  name: string;
  referral_code: string;
  center_id: number;
}

export interface ParentChild {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  classes: { id: number; name: string }[];
}

export interface ChildOverviewSession {
  id: number;
  date: string;
  topic: string | null;
  class_name: string;
}

export interface ChildOverviewClass {
  id: number;
  name: string;
  schedule: string;
  teacher_name: string | null;
  room_name: string | null;
}

export interface ChildOverviewInvoice {
  id: number;
  amount: number;
  paid: number;
  due_date: string | null;
  status: 'unpaid' | 'partial' | 'paid';
  class_name: string | null;
  note: string | null;
}

export interface ChildOverview {
  student: Student;
  classes: ChildOverviewClass[];
  upcomingSessions: ChildOverviewSession[];
  attendance: { present: number; absent: number; late: number; total: number; rate: number };
  invoices: ChildOverviewInvoice[];
  grades: Grade[];
  homework: HomeworkItem[];
  credits: CreditSummary;
}

export interface LeaveRequest {
  id: number;
  student_id: number;
  student_name: string;
  student_code: string;
  class_id: number | null;
  class_name: string | null;
  from_date: string;
  to_date: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Grade {
  id: number;
  student_id: number;
  class_id: number | null;
  title: string;
  score: number;
  max_score: number;
  comment: string | null;
  class_name?: string | null;
  created_at: string;
}

export interface HomeworkItem {
  id: number;
  class_id: number;
  title: string;
  content: string | null;
  due_date: string | null;
  class_name?: string | null;
  created_at: string;
  status: 'draft' | 'scheduled' | 'published';
  publish_at: string | null;
  max_score: number | null;
  close_date: string | null;
  kind: 'homework' | 'quiz';
  rubric_id: number | null;
  max_attempts?: number | null; // quiz: số lượt làm tối đa (null = không giới hạn)
  attempts_used?: number; // parent view, quiz: số lượt con đã làm (server cũ có thể chưa trả)
  completed_count?: number;
  student_count?: number;
  question_count?: number;
  completed?: number | boolean; // parent view: đã hoàn thành chưa
  score?: number | null; // parent view: điểm
  feedback?: string | null;
  attachments?: { id: number; name: string; url: string; kind: string }[]; // GET /homework/:id trả kèm
}

export interface Room {
  id: number;
  name: string;
  capacity: number | null;
  class_count?: number;
}

export interface PayrollRow {
  teacher_id: number;
  teacher_name: string;
  sessions: number;
  /** Đơn giá hiện hành (buổi cũ có thể tính theo đơn giá lịch sử). */
  per_session: number;
  total: number;
  /** N5-3: total / sessions. B6-2: mixed_rates = các buổi trong tháng tính theo >1 đơn giá. */
  avg_rate?: number;
  mixed_rates?: boolean;
  /** B6-2: đơn giá của chính tháng đó (hiển thị thay per_session; server cũ không có -> per_session). */
  month_rate?: number;
}

export interface TrialItem {
  id: number;
  name: string;
  phone: string;
  class_id: number | null;
  class_name: string | null;
  desired_date: string | null;
  note: string | null;
  referral_code: string | null;
  status: 'new' | 'contacted' | 'converted'; // khớp TRIAL_STATUS của server (ADM-5)
  created_at: string;
}

export interface LeadItem {
  id: number;
  name: string;
  phone: string;
  note: string | null;
  class_id: number | null;
  class_name: string | null;
  status: 'new' | 'contacted' | 'trial' | 'enrolled' | 'lost';
  created_at: string;
}

export interface ReferralItem {
  id: number;
  referrer_name?: string | null;
  referrer_phone?: string | null;
  referred_phone: string;
  referred_name?: string | null;
  referred_student_name?: string | null;
  status: 'pending' | 'rewarded' | string;
  reward_amount?: number | null;
  created_at: string;
}

export interface CreditSummary {
  total: number;
  used: number;
  available: number;
}

export interface ReviewItem {
  id: number;
  rating: number;
  comment: string | null;
  parent_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface PendingPayment {
  id: number;
  invoice_id: number;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  student_name: string;
  student_code: string;
}

export interface CenterItem {
  id: number;
  name: string;
  subdomain: string;
  phone: string | null;
  address: string | null;
  plan: 'basic' | 'standard' | 'premium';
  plan_expires_at: string | null;
  student_count?: number;
  user_count?: number;
  class_count?: number;
}

export interface PublicClassItem {
  id: number;
  name: string;
  teacher_name: string | null;
  schedule_text: string | null;
  tuition_fee: number;
  student_count: number;
}

export interface PublicCenter {
  name: string;
  phone: string | null;
  address: string | null;
}

export interface PublicTeacher {
  name: string;
  subject: string | null;
}

export interface PublicReview {
  rating: number;
  comment: string | null;
  parent_name: string | null;
  created_at: string;
}

export interface TeacherTodayItem {
  session_id: number;
  date: string;
  class_id: number;
  class_name: string;
  topic: string | null;
  schedule?: string;
  room_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  attendance_count: number;
  checked_in: boolean;
}
