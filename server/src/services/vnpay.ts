import crypto from 'crypto';

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  returnUrl: string; // VD: https://domain/api/payments/vnpay-return
}

/** URL thanh toán — dùng môi trường SANDBOX của VNPay để demo */
export const VNPAY_PAY_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** yyyyMMddHHmmss theo giờ địa phương */
function vnpDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
    vnp_CreateDate: vnpDate(new Date()),
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
  const ok = signed === received;
  const amountVnd = Math.round(Number(flat.vnp_Amount || 0) / 100);
  return {
    ok,
    success: ok && flat.vnp_ResponseCode === '00',
    params: flat,
    txnRef: flat.vnp_TxnRef || '',
    amountVnd,
  };
}
