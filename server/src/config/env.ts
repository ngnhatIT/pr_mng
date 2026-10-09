/**
 * Cấu hình tập trung từ biến môi trường.
 * Mọi module đọc config từ đây thay vì process.env rải rác —
 * sai config thì crash ngay lúc khởi động với message rõ ràng.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[CONFIG] Thiếu biến môi trường bắt buộc: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`[CONFIG] ${name} phải là số nguyên dương`);
  return n;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD: isProd,
  PORT: optionalInt('PORT', 4000),

  /** Secret ký JWT. Production BẮT BUỘC đặt, dev dùng fallback + cảnh báo. */
  JWT_SECRET: (() => {
    const s = process.env.JWT_SECRET;
    if (!s && isProd) throw new Error('[CONFIG] Production bắt buộc đặt JWT_SECRET');
    if (!s) {
      // eslint-disable-next-line no-console -- config bootstrap: logger gây circular dep với env
      console.warn('[CẢNH BÁO] JWT secret mặc định — hãy đặt JWT_SECRET khi chạy production!');
    }
    return s || 'educenter-dev-secret-change-me';
  })(),

  /** Rate limit đăng nhập: số lần tối đa mỗi cửa sổ. */
  LOGIN_RATE_LIMIT: optionalInt('LOGIN_RATE_LIMIT', 10),
  LOGIN_RATE_WINDOW_MS: optionalInt('LOGIN_RATE_WINDOW_MS', 60_000),

  /**
   * Chỉ tin header X-Forwarded-For (cho rate limit) khi chạy sau reverse proxy đáng tin.
   * Mặc định false → rate limit key theo req.socket.remoteAddress (chống bypass bằng header giả).
   */
  TRUST_PROXY: optional('TRUST_PROXY', 'false').toLowerCase() === 'true',

  /**
   * CORS allowlist, phân tách bằng dấu phẩy. Mặc định chỉ cho client local dev.
   * Production BẮT BUỘC đặt đúng domain frontend.
   */
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173,http://localhost:4000'),

  /** VNPay */
  VNPAY_TMN_CODE: optional('VNPAY_TMN_CODE', ''),
  VNPAY_HASH_SECRET: optional('VNPAY_HASH_SECRET', ''),
  VNPAY_URL: optional('VNPAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: optional('VNPAY_RETURN_URL', ''),

  /** Zalo OA */
  ZALO_OA_ID: optional('ZALO_OA_ID', ''),
  ZALO_ACCESS_TOKEN: optional('ZALO_ACCESS_TOKEN', ''),

  /**
   * Seed dữ liệu demo (tài khoản root/teacher1/0900000001 + trung tâm demo).
   * Mặc định TẮT — chỉ bật ở môi trường dev/demo.
   */
  SEED_DEMO: process.env.SEED_DEMO === 'true',

  /** Lịch backup tự động (cron expression), mặc định 2h sáng. */
  BACKUP_CRON: optional('BACKUP_CRON', '0 2 * * *'),

  /** Số bản backup giữ lại khi xoay vòng. */
  BACKUP_KEEP: optionalInt('BACKUP_KEEP', 7),

  /** Access token sống bao lâu (chuỗi jwt, vd: '1h', '30m'). Mặc định 1 giờ. */
  ACCESS_TOKEN_TTL: optional('ACCESS_TOKEN_TTL', '1h'),

  /** Refresh token sống bao nhiêu ngày. Mặc định 30 ngày. */
  REFRESH_TOKEN_DAYS: optionalInt('REFRESH_TOKEN_DAYS', 30),
} as const;

// Giữ hàm required export để module nào cần biến bắt buộc riêng thì dùng
export { required as requiredEnv };
