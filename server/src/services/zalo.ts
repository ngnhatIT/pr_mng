import { db, getSetting } from '../db';
import { getCenterSettings } from '../db/helpers';
import { logger } from '../shared/logger';
import { formatError } from '../shared/errorFormat';

const log = logger.scope('zalo');

/* ------------------------------- Cấu hình ------------------------------- */

export interface ZaloConfig {
  zalo_oa_id: string;
  zalo_access_token: string;
  zalo_template_overdue: string;
  zalo_template_upcoming: string;
  zalo_enabled: string; // '1' | '0'
  center_name: string;
  reminder_hour: string; // "08:00"
  reminder_overdue_days: string;
  reminder_upcoming_days: string;
}

const ZALO_DEFAULTS: ZaloConfig = {
  zalo_oa_id: '',
  zalo_access_token: '',
  zalo_template_overdue: '',
  zalo_template_upcoming: '',
  zalo_enabled: '0',
  center_name: 'EduCenter Pro',
  reminder_hour: '08:00',
  reminder_overdue_days: '1',
  reminder_upcoming_days: '3',
};

export const ZALO_CONFIG_KEYS = Object.keys(ZALO_DEFAULTS) as (keyof ZaloConfig)[];

export async function getZaloConfig(centerId?: number): Promise<ZaloConfig> {
  const cfg = {} as ZaloConfig;
  if (typeof centerId === 'number') {
    // Batch 1 query thay vì 9 query tuần tự (perf)
    const map = await getCenterSettings(centerId, ZALO_CONFIG_KEYS as string[]);
    for (const k of ZALO_CONFIG_KEYS) {
      cfg[k] = (map.get(k) as ZaloConfig[typeof k]) ?? ZALO_DEFAULTS[k];
    }
  } else {
    for (const k of ZALO_CONFIG_KEYS) {
      cfg[k] = await getSetting(k, ZALO_DEFAULTS[k]);
    }
  }
  return cfg;
}

/** Che access token khi trả về client: chỉ hiện 4 ký tự đầu/cuối */
export function maskAccessToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

/* --------------------------- Chuẩn hóa số điện thoại --------------------------- */

/**
 * Chuẩn hóa SĐT Việt Nam về dạng 0xxxxxxxxx (10 số).
 * Chấp nhận: 09..., +849..., 849..., 09x xxx xxxx (có khoảng trắng/dấu chấm/gạch).
 * Trả về null nếu không hợp lệ.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[\s.\-()]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length === 11) p = '0' + p.slice(2);
  if (!/^0\d{9}$/.test(p)) return null;
  return p;
}

/* ------------------------------ Template data ------------------------------ */

export interface InvoiceForReminder {
  id: number;
  amount: number;
  due_date: string | null;
  status: string;
  paid: number;
}

export interface StudentForReminder {
  id: number;
  name: string;
  phone: string | null;
}

export function formatMoneyVND(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function formatDueDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Dựng template_data cho Zalo ZNS.
 *
 * LƯU Ý QUAN TRỌNG: các tham số dưới đây PHẢI khớp tên tham số của mẫu tin nhắn
 * ZNS đã đăng ký và được Zalo duyệt (ví dụ trong mẫu đăng ký: ten_trung_tam,
 * ten_hoc_vien, so_tien, han_nop, ma_hoa_don). Khi tạo mẫu ZNS trên trang quản trị
 * Zalo OA, hãy đặt tên tham số đúng như các key này, hoặc chỉnh lại mapping ở đây
 * cho khớp với mẫu đã duyệt của trung tâm.
 */
export function buildTemplateData(
  invoice: InvoiceForReminder,
  student: StudentForReminder,
  _kind: 'overdue' | 'upcoming',
  centerName: string
): Record<string, string> {
  const remain = Math.max(0, invoice.amount - (invoice.paid || 0));
  return {
    ten_trung_tam: centerName,
    ten_hoc_vien: student.name,
    so_tien: formatMoneyVND(remain),
    han_nop: formatDueDate(invoice.due_date),
    ma_hoa_don: `HD${invoice.id}`,
  };
}

/** Nội dung tin nhắn văn bản dùng cho chế độ demo / log */
export function buildDemoMessage(
  invoice: InvoiceForReminder,
  student: StudentForReminder,
  kind: 'overdue' | 'upcoming',
  centerName: string
): string {
  const remain = Math.max(0, invoice.amount - (invoice.paid || 0));
  const title = kind === 'overdue' ? 'THÔNG BÁO HỌC PHÍ QUÁ HẠN' : 'NHẮC NỘP HỌC PHÍ';
  const lines = [
    `[${centerName}] ${title}`,
    `Kính gửi phụ huynh/học viên ${student.name},`,
    kind === 'overdue'
      ? `Học phí ${formatMoneyVND(remain)} (mã ${`HD${invoice.id}`}) đã quá hạn nộp từ ngày ${formatDueDate(invoice.due_date)}.`
      : `Học phí ${formatMoneyVND(remain)} (mã ${`HD${invoice.id}`}) đến hạn nộp ngày ${formatDueDate(invoice.due_date)}.`,
    'Quý khách vui lòng hoàn tất học phí sớm. Xin cảm ơn!',
  ];
  return lines.join('\n');
}

/* ------------------------------- Gửi ZNS thật ------------------------------- */

const ZNS_API_URL = 'https://business.openapi.zalo.me/message/template';

export async function sendZNS(params: {
  phone: string;
  templateId: string;
  templateData: Record<string, string>;
  accessToken: string;
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(ZNS_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        access_token: params.accessToken,
      },
      body: JSON.stringify({
        phone: params.phone,
        template_id: params.templateId,
        template_data: params.templateData,
        tracking_id: `edu_${Date.now()}`,
      }),
    });
    clearTimeout(timer);
    const data: unknown = await res.json().catch(() => ({}));
    const errCode = (data as { error?: number }).error;
    if (!res.ok || (typeof errCode === 'number' && errCode !== 0)) {
      const msg = (data as { message?: string }).message || `Zalo API lỗi (HTTP ${res.status})`;
      return { ok: false, error: msg, data };
    }
    return { ok: true, data };
  } catch (err) {
    // Không lọt raw error (tiếng Anh) ra UI — log server-side, trả message tiếng Việt chung
    log.error('Lỗi kết nối Zalo API', { error: formatError(err) });
    return { ok: false, error: 'Lỗi kết nối Zalo API, vui lòng thử lại' };
  }
}

/* ------------------------- Gửi nhắc học phí 1 hóa đơn ------------------------- */

export interface ReminderResult {
  demo: boolean;
  status: 'sent' | 'failed' | 'demo';
  message: string;
  phone: string | null;
}

export async function sendTuitionReminder(
  invoiceId: number,
  kind: 'overdue' | 'upcoming',
  centerId?: number
): Promise<ReminderResult> {
  const inv = (await db
    .prepare(
      `SELECT i.id, i.amount, i.due_date, i.status,
         COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = i.id AND status = 'confirmed'), 0) as paid,
         s.id as student_id, s.name as student_name, s.phone as student_phone, s.center_id
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.id = ?`
    )
    .get(invoiceId)) as
    | {
        id: number;
        amount: number;
        due_date: string | null;
        status: string;
        paid: number;
        student_id: number;
        student_name: string;
        student_phone: string | null;
        center_id: number | null;
      }
    | undefined;

  if (!inv) {
    return { demo: false, status: 'failed', message: 'Không tìm thấy hóa đơn', phone: null };
  }
  if (inv.status === 'paid') {
    return { demo: false, status: 'failed', message: 'Hóa đơn đã thanh toán đủ', phone: null };
  }

  const cfg = await getZaloConfig(centerId ?? inv.center_id ?? undefined);

  const phone = normalizePhone(inv.student_phone);
  const invoice: InvoiceForReminder = {
    id: inv.id,
    amount: inv.amount,
    due_date: inv.due_date,
    status: inv.status,
    paid: inv.paid,
  };
  const student: StudentForReminder = {
    id: inv.student_id,
    name: inv.student_name,
    phone: inv.student_phone,
  };

  const insertLog = await db.prepare(
    'INSERT INTO reminders (center_id, invoice_id, student_id, phone, kind, status, message, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  if (!phone) {
    const msg = `Học viên ${inv.student_name} chưa có số điện thoại hợp lệ`;
    await insertLog.run(
      inv.center_id,
      invoiceId,
      inv.student_id,
      inv.student_phone,
      kind,
      'failed',
      msg,
      null
    );
    return { demo: false, status: 'failed', message: msg, phone: inv.student_phone };
  }

  // Chế độ demo: chưa cấu hình token hoặc chưa bật nhắc tự động
  const demoMode = cfg.zalo_enabled !== '1' || !cfg.zalo_access_token;
  const templateId = kind === 'overdue' ? cfg.zalo_template_overdue : cfg.zalo_template_upcoming;
  const templateData = buildTemplateData(invoice, student, kind, cfg.center_name);
  const demoMessage = buildDemoMessage(invoice, student, kind, cfg.center_name);

  if (demoMode) {
    await insertLog.run(inv.center_id, invoiceId, inv.student_id, phone, kind, 'demo', demoMessage, null);
    return {
      demo: true,
      status: 'demo',
      message: `Chế độ demo — đã ghi log nhắc ${kind === 'overdue' ? 'quá hạn' : 'sắp đến hạn'} cho ${inv.student_name} (${phone}). Cấu hình Access Token để gửi ZNS thật.`,
      phone,
    };
  }

  if (!templateId) {
    const msg = 'Chưa cấu hình Template ID cho loại nhắc này';
    await insertLog.run(inv.center_id, invoiceId, inv.student_id, phone, kind, 'failed', msg, null);
    return { demo: false, status: 'failed', message: msg, phone };
  }

  // Gửi ZNS thật — ghi log status='sending' TRƯỚC khi gọi ZNS để nếu process
  // crash giữa chừng, lần chạy sau không gửi trùng (wasRemindedRecently đã thấy row).
  // Lưu ý: cần migration thêm 'sending' vào chk_reminders_status.
  const logId = Number(
    (await insertLog.run(inv.center_id, invoiceId, inv.student_id, phone, kind, 'sending', demoMessage, null))
      .lastInsertRowid
  );
  const r = await sendZNS({
    phone,
    templateId,
    templateData,
    accessToken: cfg.zalo_access_token,
  });
  const status = r.ok ? 'sent' : 'failed';
  const msg = r.ok ? demoMessage : r.error || 'Gửi thất bại';
  await db
    .prepare('UPDATE reminders SET status = ?, message = ?, response = ? WHERE id = ?')
    .run(status, msg, r.data ? JSON.stringify(r.data).slice(0, 2000) : r.error || null, logId);
  return {
    demo: false,
    status,
    message: r.ok
      ? `Đã gửi nhắc ${kind === 'overdue' ? 'quá hạn' : 'sắp đến hạn'} cho ${inv.student_name} (${phone})`
      : `Gửi thất bại: ${r.error}`,
    phone,
  };
}

/* ------------------------- Thông báo bài tập mới ------------------------- */

/** Ghi log thông báo bài tập mới cho phụ huynh (demo/log mode; ZNS cần template duyệt). */
export async function notifyHomeworkPublished(
  centerId: number | null,
  homework: { id: number; title: string; class_name: string; due_date: string | null },
  studentCount: number
): Promise<void> {
  const cfg = centerId ? await getZaloConfig(centerId) : null;
  const centerName = cfg?.center_name || 'Trung tâm';
  const msg = [
    `[${centerName}] BÀI TẬP MỚI`,
    `Lớp ${homework.class_name}: "${homework.title}"`,
    homework.due_date ? `Hạn nộp: ${formatDueDate(homework.due_date)}.` : 'Chưa đặt hạn nộp.',
    `Gửi tới ${studentCount} học viên. Phụ huynh xem chi tiết trên cổng phụ huynh.`,
  ].join('\n');
  // Lưu vào bảng reminders để tra cứu lịch sử (giống nhắc học phí demo mode)
  try {
    await db
      .prepare(
        `INSERT INTO reminders (center_id, kind, message, status, created_at)
       VALUES (?, 'homework', ?, 'demo', datetime('now'))`
      )
      .run(centerId, msg);
  } catch {
    /* bảng reminders có thể chưa có cột kind — bỏ qua */
  }
}
