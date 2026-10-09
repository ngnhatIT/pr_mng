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

export interface PaymentItem {
  id: number;
  invoice_id: number;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
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

export const REMINDER_KIND_LABEL: Record<string, string> = {
  overdue: 'Quá hạn',
  upcoming: 'Sắp đến hạn',
  test: 'Tin nhắn thử',
};

export const REMINDER_STATUS_LABEL: Record<string, string> = {
  sent: 'Đã gửi',
  failed: 'Thất bại',
  demo: 'Demo',
};

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  studying: 'Đang học',
  paused: 'Tạm nghỉ',
  quit: 'Đã nghỉ',
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Chưa thanh toán',
  partial: 'Thanh toán một phần',
  paid: 'Đã thanh toán',
};

export const ATTENDANCE_LABEL: Record<string, string> = {
  present: 'Có mặt',
  absent: 'Vắng',
  late: 'Muộn',
};

export const DAY_NAMES: Record<number, string> = {
  2: 'Thứ Hai',
  3: 'Thứ Ba',
  4: 'Thứ Tư',
  5: 'Thứ Năm',
  6: 'Thứ Sáu',
  7: 'Thứ Bảy',
  8: 'Chủ Nhật',
};

export function formatVND(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Định dạng ngày giờ đầy đủ: "08/10/2026 14:30" */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const time = iso.slice(11, 16);
  return `${formatDate(iso)}${time ? ` ${time}` : ''}`;
}

export function formatScheduleText(scheduleJson: string): string {
  try {
    const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
    return s.map((e) => `${DAY_NAMES[e.day] || ''} ${e.start}-${e.end}`).join(', ');
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
  status: 'new' | 'contacted' | 'trialed' | 'enrolled' | 'lost';
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
  referred_phone: string;
  referred_name?: string | null;
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

export const LEAVE_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
};

export const TRIAL_STATUS_LABEL: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  trialed: 'Đã học thử',
  enrolled: 'Đã đăng ký',
  lost: 'Mất',
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  trial: 'Học thử',
  enrolled: 'Đăng ký',
  lost: 'Mất',
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
};

export const PLAN_LABEL: Record<string, string> = {
  basic: 'Cơ bản',
  standard: 'Tiêu chuẩn',
  premium: 'Cao cấp',
};

export const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Quản trị hệ thống',
  admin: 'Quản trị viên',
  staff: 'Nhân viên',
  teacher: 'Giáo viên',
  parent: 'Phụ huynh',
};

export function labelOf(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
