import { db, getSetting, setCenterSetting } from '../db';
import { getCenterSettings } from '../db/helpers';
import { logger } from '../shared/logger';
import { formatError } from '../shared/errorFormat';
import { todayVN } from '../shared/vnTime';
import { sendAlert } from '../shared/alert';
import { DAY_MS } from '../shared/time';
import { withAdvisoryLock } from '../shared/advisoryLock';

const log = logger.scope('zalo');

/* ------------------------------- Cấu hình ------------------------------- */

export interface ZaloConfig {
  zalo_oa_id: string;
  zalo_access_token: string;
  zalo_refresh_token: string; // H1: dùng để tự động refresh access token
  zalo_app_id: string; // H1: Zalo App ID (khác OA ID) — cần cho refresh token
  zalo_app_secret: string; // H1: App Secret — chỉ lưu ở settings, không hard-code
  zalo_token_expires_at: string; // H1: epoch ms khi access token hết hạn ('' = chưa biết)
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
  zalo_refresh_token: '',
  zalo_app_id: '',
  zalo_app_secret: '',
  zalo_token_expires_at: '',
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
 *
 * TODO: định dạng SĐT gửi Zalo ZNS (0xxx vs 84xxx) CHƯA xác minh được —
 * cần 1 tin test thật để quyết định, GIỮ NGUYÊN hàm này cho đến lúc đó.
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

/**
 * Phân loại mã lỗi Zalo (bảng mã lỗi Official Account API, stc-developers.zdn.vn):
 * - token: -216 (access token không hợp lệ), -220 (token hết hạn/bị gỡ)
 * - quota: -218 (hết quota gửi đến người dùng — "Out of quota receive")
 * - template: -6 (template_id không tồn tại), -7 (template bị khóa/chưa duyệt)
 */
const ZNS_TOKEN_ERRORS = new Set([-216, -220]);
const ZNS_QUOTA_ERRORS = new Set([-218]);
const ZNS_TEMPLATE_ERRORS = new Set([-6, -7]);

/** Access token Zalo hỏng/hết hạn: cần cập nhật token, scheduler phải dừng vòng chạy. */
export class ZaloTokenError extends Error {
  readonly zaloCode: number;
  constructor(zaloCode: number, message: string) {
    super(message);
    this.name = 'ZaloTokenError';
    this.zaloCode = zaloCode;
  }
}

/** Hết quota Zalo: gửi tiếp cũng lỗi, scheduler phải dừng vòng chạy hiện tại. */
export class ZaloQuotaError extends Error {
  readonly zaloCode: number;
  constructor(zaloCode: number, message: string) {
    super(message);
    this.name = 'ZaloQuotaError';
    this.zaloCode = zaloCode;
  }
}

/** Alert lỗi template 1 lần/ngày để không spam khi cả vòng chạy cùng lỗi. */
let lastTemplateAlertAt = 0;

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
      if (typeof errCode === 'number') {
        // Token hỏng/hết hạn: alert + ném lỗi typed để scheduler dừng vòng chạy
        if (ZNS_TOKEN_ERRORS.has(errCode)) {
          log.error(`Zalo access token hết hạn/không hợp lệ (mã ${errCode})`, { message: msg });
          await sendAlert(
            'Zalo: access token hết hạn hoặc không hợp lệ',
            `Mã lỗi ${errCode}: ${msg}. Cập nhật token trong Cấu hình Zalo.`
          );
          throw new ZaloTokenError(errCode, msg);
        }
        // Hết quota: gửi tiếp cũng lỗi -> alert + ném để scheduler dừng vòng chạy
        if (ZNS_QUOTA_ERRORS.has(errCode)) {
          await sendAlert(
            'Zalo: hết quota gửi tin',
            `Mã lỗi ${errCode}: ${msg}. Vòng nhắc dừng, kiểm tra gói ZNS.`
          );
          throw new ZaloQuotaError(errCode, msg);
        }
        // Template chưa duyệt/bị khóa: alert 1 lần/ngày, vẫn trả failed để retry hôm sau
        if (ZNS_TEMPLATE_ERRORS.has(errCode)) {
          const now = Date.now();
          if (now - lastTemplateAlertAt > DAY_MS) {
            lastTemplateAlertAt = now;
            await sendAlert(
              'Zalo: template chưa được duyệt hoặc bị khóa',
              `Mã lỗi ${errCode}: ${msg}. Kiểm tra Template ID trong Cấu hình Zalo.`
            );
          }
        }
      }
      return { ok: false, error: msg, data };
    }
    return { ok: true, data };
  } catch (err) {
    // Lỗi typed (token/quota) phải lọt ra ngoài để scheduler dừng vòng chạy
    if (err instanceof ZaloTokenError || err instanceof ZaloQuotaError) throw err;
    // Không lọt raw error (tiếng Anh) ra UI — log server-side, trả message tiếng Việt chung
    log.error('Lỗi kết nối Zalo API', { error: formatError(err) });
    return { ok: false, error: 'Lỗi kết nối Zalo API, vui lòng thử lại' };
  }
}

/* ------------------------- Tự động refresh access token ------------------------- */

const ZALO_OAUTH_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
/** Mã lỗi Zalo trả về khi access token hết hạn/không hợp lệ. */
export const ZALO_ERR_INVALID_TOKEN = -216;
/**
 * Mã lỗi ZNS khi người dùng chưa follow OA / không nhận được ZNS
 * (-114: không nhận được ZNS; -119: tài khoản không thể nhận ZNS).
 */
export const ZALO_ERR_NOT_RECEIVABLE = [-114, -119];
/** Chủ động refresh khi token còn dưới 24h (tránh gửi fail giữa chừng). */
const PROACTIVE_REFRESH_MS = 24 * 3600 * 1000;

/**
 * H1: đổi refresh token lấy access token mới, lưu vào center_settings.
 * Bọc advisory lock để 2 worker không refresh đồng thời làm vô hiệu lẫn nhau.
 * Thất bại -> logger.error + sendAlert (không throw ra caller).
 */
export async function refreshZaloAccessToken(centerId: number): Promise<boolean> {
  const outcome = await withAdvisoryLock(`zalo-token-refresh:${centerId}`, async () => {
    // Đọc lại trong lock: worker khác có thể vừa refresh xong
    const cfg = await getZaloConfig(centerId);
    if (!cfg.zalo_refresh_token) {
      log.warn('Zalo: chưa cấu hình refresh token, bỏ qua auto-refresh', { centerId });
      return false;
    }
    const expiresAt = Number(cfg.zalo_token_expires_at);
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60 * 1000) {
      return true; // token vẫn dùng được — worker khác vừa refresh
    }
    if (!cfg.zalo_app_id || !cfg.zalo_app_secret) {
      log.warn('Zalo: thiếu app_id/app_secret nên không refresh được access token', { centerId });
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(ZALO_OAUTH_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          secret_key: cfg.zalo_app_secret, // secret lấy từ settings, không hard-code
        },
        body: new URLSearchParams({
          app_id: cfg.zalo_app_id,
          grant_type: 'refresh_token',
          refresh_token: cfg.zalo_refresh_token,
        }).toString(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: string | number;
        error_description?: string;
      };
      if (!res.ok || !data.access_token) {
        throw new Error(`Zalo OAuth lỗi: ${data.error_description || `HTTP ${res.status}`}`);
      }
      await setCenterSetting(centerId, 'zalo_access_token', data.access_token);
      if (data.refresh_token) {
        await setCenterSetting(centerId, 'zalo_refresh_token', data.refresh_token);
      }
      const expiresInMs = Number(data.expires_in) * 1000;
      if (Number.isFinite(expiresInMs) && expiresInMs > 0) {
        await setCenterSetting(centerId, 'zalo_token_expires_at', String(Date.now() + expiresInMs));
      }
      // setCenterSetting đã invalidate cache getCenterSettings — lần đọc sau thấy token mới
      log.info('Zalo: đã refresh access token thành công', { centerId });
      return true;
    } finally {
      clearTimeout(timer);
    }
  });
  if (outcome.status === 'error') {
    const detail = formatError(outcome.error);
    log.error('Zalo: refresh access token thất bại', { centerId, error: detail });
    await sendAlert('Zalo refresh token thất bại', `Trung tâm #${centerId}: ${detail}`);
    return false;
  }
  // 'locked' = worker khác đang refresh -> coi như OK, lần gửi sau dùng token mới
  return outcome.status === 'done' ? (outcome.result ?? false) : true;
}

/** H1: chủ động refresh khi access token sắp hết hạn (best-effort, không throw). */
export async function ensureZaloTokenFresh(centerId: number | null | undefined): Promise<void> {
  if (!centerId) return;
  try {
    const cfg = await getZaloConfig(centerId);
    if (!cfg.zalo_refresh_token || !cfg.zalo_token_expires_at) return;
    const expiresAt = Number(cfg.zalo_token_expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > PROACTIVE_REFRESH_MS) return;
    await refreshZaloAccessToken(centerId);
  } catch (err) {
    log.warn('ensureZaloTokenFresh thất bại (best-effort)', { error: formatError(err) });
  }
}

/* ------------------------- Gửi nhắc học phí 1 hóa đơn ------------------------- */

/**
 * Khóa chống gửi trùng ZNS: mỗi hóa đơn + loại nhắc chỉ có 1 log hiệu lực mỗi ngày
 * (giờ VN). Dùng với ON CONFLICT DO NOTHING trên unique index reminders_dedup_key_unique.
 */
export function buildDedupKey(invoiceId: number, kind: string, date: string = todayVN()): string {
  return `${invoiceId}:${kind}:${date}`;
}

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
         s.id as student_id, s.name as student_name, s.phone as student_phone, s.center_id,
         (SELECT p.phone FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
          WHERE ps.student_id = s.id ORDER BY ps.id LIMIT 1) as parent_phone,
         (SELECT p.id FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
          WHERE ps.student_id = s.id ORDER BY ps.id LIMIT 1) as parent_id
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.id = ? AND s.status != 'quit'`
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
        parent_phone: string | null;
        parent_id: number | null;
        center_id: number | null;
      }
    | undefined;

  if (!inv) {
    return { demo: false, status: 'failed', message: 'Không tìm thấy hóa đơn (hoặc học viên đã nghỉ học)', phone: null };
  }
  if (inv.status === 'paid') {
    return { demo: false, status: 'failed', message: 'Hóa đơn đã thanh toán đủ', phone: null };
  }

  const cfg = await getZaloConfig(centerId ?? inv.center_id ?? undefined);

  // H3: ZNS gửi cho PHỤ HUYNH (người đóng học phí), không phải học viên.
  // Ưu tiên SĐT phụ huynh liên kết đầu tiên, fallback SĐT học viên khi chưa liên kết.
  const phone = normalizePhone(inv.parent_phone) ?? normalizePhone(inv.student_phone);
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
    const msg = `Học viên ${inv.student_name} chưa có SĐT phụ huynh/học viên hợp lệ`;
    const rawPhone = inv.parent_phone ?? inv.student_phone;
    await insertLog.run(
      inv.center_id,
      invoiceId,
      inv.student_id,
      rawPhone,
      kind,
      'failed',
      msg,
      null
    );
    return { demo: false, status: 'failed', message: msg, phone: rawPhone };
  }

  // H5: phụ huynh đã từ chối nhận tin Zalo -> bỏ qua, không gửi (kể cả demo)
  if (inv.parent_id) {
    const prow = (await db
      .prepare('SELECT zalo_consent FROM parents WHERE id = ?')
      .get(inv.parent_id)) as { zalo_consent: string | null } | undefined;
    if (prow?.zalo_consent === 'denied') {
      const msg = `Phụ huynh của ${inv.student_name} đã từ chối nhận tin Zalo — bỏ qua`;
      log.info('Bỏ qua nhắc ZNS: phụ huynh denied consent', { parentId: inv.parent_id, invoiceId });
      await insertLog.run(inv.center_id, invoiceId, inv.student_id, phone, kind, 'failed', msg, null);
      return { demo: false, status: 'failed', message: msg, phone };
    }
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
  // dedup_key + ON CONFLICT DO NOTHING: 2 tiến trình cùng insert thì 1 bên thắng,
  // bên thua (changes=0) coi như đã nhắc hôm nay và bỏ qua.
  const dedupKey = buildDedupKey(invoiceId, kind);
  const insertRes = await db
    .prepare(
      `INSERT INTO reminders (center_id, invoice_id, student_id, phone, kind, status, message, response, dedup_key)
       VALUES (?, ?, ?, ?, ?, 'sending', ?, NULL, ?)
       ON CONFLICT DO NOTHING`
    )
    .run(inv.center_id, invoiceId, inv.student_id, phone, kind, demoMessage, dedupKey);
  let logId: number;
  if (insertRes.changes === 0) {
    // Trùng với log đang hiệu lực hôm nay. Ngoại lệ: row 'sending' kẹt > 30 phút
    // (crash giữa chừng) thì tái sử dụng để gửi lại — khớp wasRemindedRecently.
    const stale = (await db
      .prepare(
        `SELECT id FROM reminders
         WHERE dedup_key = ? AND status = 'sending' AND created_at < datetime('now', '-30 minutes')`
      )
      .get(dedupKey)) as { id: number } | undefined;
    if (!stale) {
      return { demo: false, status: 'failed', message: 'Hóa đơn này đã được nhắc hôm nay (chống gửi trùng)', phone };
    }
    logId = stale.id;
  } else {
    logId = Number(insertRes.lastInsertRowid);
  }
  // H1: chủ động refresh token nếu sắp hết hạn (best-effort)
  await ensureZaloTokenFresh(inv.center_id);
  const sendOnce = (accessToken: string) =>
    sendZNS({ phone, templateId, templateData, accessToken });
  let r: { ok: boolean; data?: unknown; error?: string };
  try {
    r = await sendOnce(cfg.zalo_access_token);
    // H1: Zalo báo token hết hạn (-216) -> refresh rồi gửi lại 1 lần
    const errCode = (r.data as { error?: number } | undefined)?.error;
    if (!r.ok && errCode === ZALO_ERR_INVALID_TOKEN && inv.center_id) {
      log.warn('Zalo access token hết hạn khi gửi ZNS, thử refresh', { centerId: inv.center_id });
      if (await refreshZaloAccessToken(inv.center_id)) {
        const freshCfg = await getZaloConfig(centerId ?? inv.center_id ?? undefined);
        if (freshCfg.zalo_access_token) r = await sendOnce(freshCfg.zalo_access_token);
      }
    }
  } catch (err) {
    // Lỗi hệ thống Zalo (token/quota): ghi log failed rồi ném tiếp để scheduler dừng vòng chạy
    const msg = err instanceof Error ? err.message : 'Lỗi Zalo không xác định';
    await db.prepare('UPDATE reminders SET status = ?, message = ? WHERE id = ?').run('failed', msg, logId);
    throw err;
  }
  const status = r.ok ? 'sent' : 'failed';
  let msg = r.ok ? demoMessage : r.error || 'Gửi thất bại';
  // H5: Zalo báo người dùng chưa follow OA / không nhận được ZNS (-114, -119)
  // -> đánh dấu rõ để nhân viên nhắc phụ huynh follow OA của trung tâm
  const zaloErr = Number((r.data as { error?: number } | undefined)?.error);
  if (!r.ok && ZALO_ERR_NOT_RECEIVABLE.includes(zaloErr)) {
    msg = `Người dùng (${phone}) chưa follow OA hoặc đã tắt nhận ZNS — nhắc phụ huynh follow OA của trung tâm để nhận tin. Chi tiết: ${r.error}`;
    log.warn('Zalo: người dùng chưa follow OA / không nhận ZNS', { phone, invoiceId, zaloErr });
  }
  await db
    .prepare('UPDATE reminders SET status = ?, message = ?, response = ? WHERE id = ?')
    .run(status, msg, r.data ? JSON.stringify(r.data).slice(0, 2000) : r.error || null, logId);
  return {
    demo: false,
    status,
    message: r.ok
      ? `Đã gửi nhắc ${kind === 'overdue' ? 'quá hạn' : 'sắp đến hạn'} cho ${inv.student_name} (${phone})`
      : `Gửi thất bại: ${msg}`,
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
