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
  scheduleText: string;
}

export interface DashboardData {
  totalStudents: number;
  studyingStudents: number;
  totalTeachers: number;
  activeClasses: number;
  revenueThisMonth: number;
  unpaidTotal: number;
  todaySessions: TodaySession[];
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
  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'vi-VN', { weekday: 'long' });
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
export function formatVND(n: number, locale?: string): string {
  const lang = locale ?? i18n.language;
  if (lang === 'en') {
    return `${Math.round(n).toLocaleString('en-US')} VND`;
  }
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
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

/** Định dạng ngày giờ đầy đủ: "08/10/2026 14:30" */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const time = iso.slice(11, 16);
  return `${formatDate(iso)}${time ? ` ${time}` : ''}`;
}

export function formatScheduleText(scheduleJson: string): string {
  try {
    const names = getDayNames();
    const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
    return s.map((e) => `${names[e.day] || ''} ${e.start}-${e.end}`).join(', ');
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
  completed_count?: number;
  student_count?: number;
  question_count?: number;
  completed?: number | boolean; // parent view: đã hoàn thành chưa
  score?: number | null; // parent view: điểm
  feedback?: string | null;
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
  per_session: number;
  total: number;
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
  status: 'new' | 'contacted' | 'trialed' | 'enrolled' | 'lost' | 'converted';
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
  attendance_count: number;
  checked_in: boolean;
}
