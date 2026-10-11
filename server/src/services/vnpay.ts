import crypto from 'crypto';
import { env } from '../config/env';

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  returnUrl: string; // VD: https://domain/api/payments/vnpay-return
}

/** URL thanh toán / API merchant (querydr) — cấu hình qua env (config/env.ts), mặc định sandbox */
export const VNPAY_PAY_URL = env.VNPAY_PAY_URL;
export const VNPAY_API_URL = env.VNPAY_API_URL;

/** yyyyMMddHHmmss theo giờ Việt Nam (VNPay yêu cầu GMT+7, không phụ thuộc TZ server) */
export function vnpDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/** Ngược của vnpDate: 'yyyyMMddHHmmss' (giờ VN, GMT+7) -> Date */
function parseVnpDate(s: string): Date {
  const n = (a: number, b: number) => Number(s.slice(a, b));
  return new Date(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10) - 7, n(10, 12), n(12, 14)));
}

/** Encode giống mẫu VNPay 2.1.0 (Node sortObject / PHP urlencode): khoảng trắng -> '+' */
const enc = (s: string): string => encodeURIComponent(s).replace(/%20/g, '+');

/**
 * PAY-1: chuỗi ký VNPay 2.1.0 — key tăng dần, `enc(k)=enc(v)` nối bằng '&'.
 * Chuỗi này đồng thời là query string gửi đi (VNPay hash lại đúng chuỗi đã encode).
 */
function buildSignData(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => [enc(k), enc(params[k])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function hmac512(secret: string, data: string): string {
  return crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');
}

/** So sánh constant-time (M7: chống timing attack) */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf-8');
  const y = Buffer.from(b.toLowerCase(), 'utf-8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Bỏ dấu tiếng Việt cho orderInfo (VNPay khuyến nghị không dấu, không ký tự đặc biệt) */
function unsign(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[&=#?]/g, ' ')
    .slice(0, 100);
}

export function buildVnpayUrl(
  cfg: VnpayConfig,
  opts: {
    amountVnd: number;
    txnRef: string;
    orderInfo: string;
    ipAddr: string;
    /** PAY-4: vnp_CreateDate đã lưu ở payment_txns (txn tái sử dụng) — querydr cần đúng ngày này */
    createDate?: string;
  }
): string {
  const createDate = opts.createDate || vnpDate(new Date());
  const params: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: cfg.tmnCode,
    vnp_Amount: String(Math.round(opts.amountVnd) * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: opts.txnRef,
    vnp_OrderInfo: unsign(opts.orderInfo),
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: cfg.returnUrl,
    vnp_IpAddr: opts.ipAddr || '127.0.0.1',
    vnp_CreateDate: createDate,
    // G6: đơn hết hạn sau 30 phút kể từ vnp_CreateDate — VNPay không cho thanh toán muộn
    vnp_ExpireDate: vnpDate(new Date(parseVnpDate(createDate).getTime() + 30 * 60 * 1000)),
  };
  const signData = buildSignData(params);
  return `${VNPAY_PAY_URL}?${signData}&vnp_SecureHash=${hmac512(cfg.hashSecret, signData)}`;
}

export interface VnpayVerifyResult {
  ok: boolean;
  success: boolean; // vnp_ResponseCode === '00' và vnp_TransactionStatus (nếu có) === '00'
  params: Record<string, string>;
  txnRef: string;
  amountVnd: number;
}

/** Kiểm tra chữ ký VNPay trả về ở returnUrl/IPN — chỉ ký trên các key vnp_* (PAY-1) */
export function verifyVnpayReturn(
  query: Record<string, string | string[] | undefined>,
  hashSecret: string
): VnpayVerifyResult {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('vnp_') || k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
    flat[k] = Array.isArray(v) ? String(v[0]) : String(v ?? '');
  }
  const received = Array.isArray(query.vnp_SecureHash) ? query.vnp_SecureHash[0] : query.vnp_SecureHash;
  const ok = !!hashSecret && safeEqual(hmac512(hashSecret, buildSignData(flat)), String(received || ''));
  const amountVnd = Math.round(Number(flat.vnp_Amount || 0) / 100);
  // PAY-6: giao dịch thành công khi CẢ ResponseCode và TransactionStatus đều '00'
  const txStatus = flat.vnp_TransactionStatus;
  return {
    ok,
    success: ok && flat.vnp_ResponseCode === '00' && (txStatus === undefined || txStatus === '00'),
    params: flat,
    txnRef: flat.vnp_TxnRef || '',
    amountVnd,
  };
}

export interface VnpayQuerydrResult {
  /** Gọi API thành công + verify được chữ ký phản hồi */
  ok: boolean;
  /** vnp_ResponseCode của querydr ('00' = truy vấn thành công) */
  responseCode: string;
  /** vnp_TransactionStatus ('00' = giao dịch thành công — khác với responseCode) */
  transactionStatus: string;
  /** Toàn bộ params phản hồi (đã verify chữ ký) — dùng cho đối soát */
  params: Record<string, string>;
  error?: string;
}

/** PAY-4: thứ tự trường checksum querydr theo tài liệu VNPay (pipe-delimited, KHÔNG sắp xếp) */
const QUERYDR_REQ_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_TransactionDate',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
];
const QUERYDR_RES_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
  'vnp_PromotionCode',
  'vnp_PromotionAmount',
];
const querydrSignData = (fields: string[], p: Record<string, string>): string =>
  fields.map((k) => p[k] ?? '').join('|');

/**
 * G6: Truy vấn kết quả giao dịch (querydr) — dùng khi đơn treo quá lâu mà
 * không thấy IPN/return. Checksum request/response theo chuỗi '|' cố định (PAY-4).
 * transactionDate PHẢI là vnp_CreateDate đã gửi trong URL thanh toán.
 */
export async function queryVnpayTransaction(
  cfg: VnpayConfig,
  opts: { txnRef: string; orderInfo: string; transactionDate: string; ipAddr?: string }
): Promise<VnpayQuerydrResult> {
  const fail = (error: string): VnpayQuerydrResult => ({
    ok: false,
    responseCode: '',
    transactionStatus: '',
    params: {},
    error,
  });
  const params: Record<string, string> = {
    vnp_RequestId: crypto.randomUUID().replace(/-/g, ''),
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: cfg.tmnCode,
    vnp_TxnRef: opts.txnRef,
    vnp_OrderInfo: unsign(opts.orderInfo),
    vnp_TransactionDate: opts.transactionDate,
    vnp_CreateDate: vnpDate(new Date()),
    vnp_IpAddr: opts.ipAddr || '127.0.0.1',
  };
  const signed = hmac512(cfg.hashSecret, querydrSignData(QUERYDR_REQ_FIELDS, params));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(VNPAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, vnp_SecureHash: signed }),
      signal: controller.signal,
    });
    if (!res.ok) return fail(`VNPay API HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) flat[k] = v === null || v === undefined ? '' : String(v);
    // Verify chữ ký phản hồi (M7: constant-time) — chống giả mạo kết quả đối soát
    const expected = hmac512(cfg.hashSecret, querydrSignData(QUERYDR_RES_FIELDS, flat));
    if (!safeEqual(expected, flat.vnp_SecureHash || '')) {
      return fail('Chữ ký phản hồi querydr không hợp lệ');
    }
    return {
      ok: true,
      responseCode: flat.vnp_ResponseCode || '',
      transactionStatus: flat.vnp_TransactionStatus || '',
      params: flat,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
