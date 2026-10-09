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

  /** PostgreSQL connection string. BẮT BUỘC (fail-fast khi boot). */
  DATABASE_URL: (() => {
    const u = process.env.DATABASE_URL;
    if (!u) throw new Error('[CONFIG] Thiếu DATABASE_URL');
    return u;
  })(),

  /** Secret ký JWT. Production BẮT BUỘC đặt, dev dùng fallback + cảnh báo. */
  JWT_SECRET: (() => {
    const s = process.env.JWT_SECRET;
    if (!s && isProd) throw new Error('[CONFIG] Production bắt buộc đặt JWT_SECRET');
    // Secret ngắn làm JWT brute-force khả thi — yêu cầu tối thiểu 32 ký tự ở production
    if (s && isProd && s.length < 32) {
      throw new Error('[CONFIG] JWT_SECRET phải từ 32 ký tự trở lên (hiện tại ' + s.length + ')');
    }
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
  /** CORS origins (cách nhau bằng dấu phẩy). Không trailing slash, đúng format http(s)://host. */
  CORS_ORIGIN: (() => {
    const v = optional('CORS_ORIGIN', 'http://localhost:5173,http://localhost:4000');
    const origins = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const o of origins) {
      if (!/^https?:\/\/[^/]+$/.test(o)) {
        throw new Error(
          `[CONFIG] CORS_ORIGIN sai format: "${o}" (đúng: "https://app.vn", không trailing slash)`
        );
      }
    }
    if (isProd && origins.every((o) => o.includes('localhost'))) {
      // eslint-disable-next-line no-console
      console.warn('[CONFIG] Cảnh báo: production đang dùng CORS localhost — kiểm tra lại CORS_ORIGIN');
    }
    return v;
  })(),

  /**
   * Base URL công khai của app (dùng cho VNPay returnUrl gửi bên thứ 3).
   * Nếu không đặt, fallback theo request (req.protocol + host).
   */
  APP_BASE_URL: (() => {
    const v = optional('APP_BASE_URL', '');
    if (v && !/^https?:\/\/[^/]+$/.test(v)) {
      throw new Error(`[CONFIG] APP_BASE_URL sai format: "${v}" (đúng: "https://app.vn", không trailing slash)`);
    }
    return v;
  })(),

  /**
   * VNPay / Zalo: credential thực tế lưu per-center trong DB (center_settings),
   * KHÔNG đọc từ env. Giữ lại để tương thích nhưng đừng đặt nhầm tưởng có tác dụng.
   */
  /** VNPay (legacy — cấu hình trong DB per-center) */
  VNPAY_TMN_CODE: optional('VNPAY_TMN_CODE', ''),
  VNPAY_HASH_SECRET: optional('VNPAY_HASH_SECRET', ''),
  VNPAY_URL: optional('VNPAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: optional('VNPAY_RETURN_URL', ''),

  /** Zalo OA (legacy — cấu hình trong DB per-center) */
  ZALO_OA_ID: optional('ZALO_OA_ID', ''),
  ZALO_ACCESS_TOKEN: optional('ZALO_ACCESS_TOKEN', ''),

  /**
   * Seed dữ liệu demo (tài khoản root/teacher1/0900000001 + trung tâm demo).
   * Mặc định TẮT — chỉ bật ở môi trường dev/demo.
   * Fail-fast nếu bật trên production (tránh tạo nhầm center demo trên DB thật).
   */
  SEED_DEMO: (() => {
    const v = process.env.SEED_DEMO === 'true';
    if (v && process.env.NODE_ENV === 'production') {
      throw new Error('[CONFIG] SEED_DEMO=true không được phép trên production');
    }
    return v;
  })(),

  /** Lịch backup tự động (cron expression), mặc định 2h sáng. */
  BACKUP_CRON: optional('BACKUP_CRON', '0 2 * * *'),

  /** Số bản backup giữ lại khi xoay vòng. */
  BACKUP_KEEP: optionalInt('BACKUP_KEEP', 7),

  /** Webhook nhận cảnh báo vận hành (backup fail...). Optional. */
  ALERT_WEBHOOK_URL: optional('ALERT_WEBHOOK_URL', ''),

  /** Access token sống bao lâu (chuỗi jwt, vd: '1h', '30m'). Mặc định 1 giờ. */
  ACCESS_TOKEN_TTL: (() => {
    const v = optional('ACCESS_TOKEN_TTL', '1h');
    // Fail-fast nếu format sai (vd: '60' thiếu đơn vị) — tránh chạy với TTL không mong muốn
    if (!/^\d+[smhd]$/.test(v)) {
      throw new Error(`[CONFIG] ACCESS_TOKEN_TTL sai format: "${v}" (vd đúng: "1h", "30m")`);
    }
    return v;
  })(),

  /** Refresh token sống bao nhiêu ngày. Mặc định 30 ngày. */
  REFRESH_TOKEN_DAYS: optionalInt('REFRESH_TOKEN_DAYS', 30),
} as const;

// Giữ hàm required export để module nào cần biến bắt buộc riêng thì dùng
export { required as requiredEnv };
