import crypto from 'crypto';

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  returnUrl: string; // VD: https://domain/api/payments/vnpay-return
}

/** URL thanh toán — cấu hình qua VNPAY_PAY_URL (mặc định sandbox để demo) */
export const VNPAY_PAY_URL =
  process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

/** URL API merchant (querydr/hoàn tiền) — cấu hình qua VNPAY_API_URL */
export const VNPAY_API_URL =
  process.env.VNPAY_API_URL || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

/** yyyyMMddHHmmss theo giờ Việt Nam (VNPay yêu cầu GMT+7, không phụ thuộc TZ server) */
function vnpDate(d: Date): string {
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

/** Sắp xếp key tăng dần rồi nối key=value bằng & (KHÔNG encode) — đúng chuẩn mẫu VNPay Node.js */
function buildSignData(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** Bỏ dấu tiếng Việt để orderInfo an toàn trong URL không encode */
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
  opts: { amountVnd: number; txnRef: string; orderInfo: string; ipAddr: string }
): string {
  const now = new Date();
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
    vnp_CreateDate: vnpDate(now),
    // G6: đơn hết hạn sau 30 phút — VNPay không cho thanh toán muộn, cron đối soát
    // chỉ đánh failed đơn treo quá 60 phút nên không thể trừ tiền 2 lần / muộn
    vnp_ExpireDate: vnpDate(new Date(now.getTime() + 30 * 60 * 1000)),
  };
  const signData = buildSignData(params);
  const signed = crypto
    .createHmac('sha512', cfg.hashSecret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
  return `${VNPAY_PAY_URL}?${signData}&vnp_SecureHash=${signed}`;
}

export interface VnpayVerifyResult {
  ok: boolean;
  success: boolean; // vnp_ResponseCode === '00'
  params: Record<string, string>;
  txnRef: string;
  amountVnd: number;
}

/** Kiểm tra chữ ký VNPay trả về ở returnUrl */
export function verifyVnpayReturn(
  query: Record<string, string | string[] | undefined>,
  hashSecret: string
): VnpayVerifyResult {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
    flat[k] = Array.isArray(v) ? String(v[0]) : String(v ?? '');
  }
  const signData = buildSignData(flat);
  const signed = crypto.createHmac('sha512', hashSecret).update(Buffer.from(signData, 'utf-8')).digest('hex');
  const received = String(query.vnp_SecureHash || '');
  // M7: so sánh constant-time để chống timing attack
  const a = Buffer.from(signed, 'utf-8');
  const b = Buffer.from(received, 'utf-8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  const amountVnd = Math.round(Number(flat.vnp_Amount || 0) / 100);
  return {
    ok,
    success: ok && flat.vnp_ResponseCode === '00',
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

/**
 * G6: Truy vấn kết quả giao dịch (querydr) — dùng khi đơn treo quá lâu mà
 * không thấy IPN/return. Ký HMAC-SHA512 đúng chuẩn như verifyVnpayReturn.
 * Lưu ý: wire format (POST JSON) theo sample chính thức của VNPay — cần kiểm
 * chứng lại với sandbox khi có credentials thật.
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
  const signData = buildSignData(params);
  const signed = crypto
    .createHmac('sha512', cfg.hashSecret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
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
    for (const [k, v] of Object.entries(data)) flat[k] = String(v ?? '');
    // Verify chữ ký phản hồi (M7: constant-time) — chống giả mạo kết quả đối soát
    const signBack = buildSignData(
      Object.fromEntries(Object.entries(flat).filter(([k]) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType'))
    );
    const expected = crypto.createHmac('sha512', cfg.hashSecret).update(Buffer.from(signBack, 'utf-8')).digest('hex');
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(flat.vnp_SecureHash || '', 'utf-8');
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
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
