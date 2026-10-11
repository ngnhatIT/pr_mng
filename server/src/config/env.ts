/**
 * Cấu hình tập trung từ biến môi trường.
 * Mọi module đọc config từ đây thay vì process.env rải rác —
 * sai config thì crash ngay lúc khởi động với message rõ ràng.
 */
import dotenv from 'dotenv';
import path from 'path';

// Nạp DUY NHẤT server/.env (src/config hoặc dist/config -> ../../.env), trước khi
// đọc process.env. Biến môi trường thật (PM2/systemd/CI) luôn thắng file.
// quiet: dotenv 17+ in "injected env" ra stdout — làm bẩn log JSON production.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

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

/** COR-1: URL VNPay phải là https; production còn trỏ sandbox -> cảnh báo (tiền thật sẽ không về) */
function vnpayUrl(name: string, fallback: string): string {
  const v = optional(name, '') || fallback;
  if (!/^https:\/\/[^\s]+$/.test(v))
    throw new Error(`[CONFIG] ${name} sai format: "${v}" (phải là URL https)`);
  if (isProd && v.includes('sandbox')) {
    // eslint-disable-next-line no-console -- config bootstrap: logger gây circular dep với env
    console.warn(`[CONFIG] Cảnh báo: production đang dùng VNPay SANDBOX (${name}) — đặt URL production`);
  }
  return v;
}

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

  /**
   * Secret ký JWT (>= 32 ký tự). BẮT BUỘC trừ khi NODE_ENV là 'development' hoặc 'test' TƯỜNG MINH —
   * staging/'prod'/NODE_ENV rỗng (PM2 thiếu --env, Docker) không còn âm thầm dùng secret công khai
   * trong repo (ai đọc repo cũng ký được token superadmin).
   */
  JWT_SECRET: (() => {
    const s = process.env.JWT_SECRET;
    const devLike = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!s && !devLike) {
      throw new Error("[CONFIG] Thiếu JWT_SECRET (chỉ được bỏ trống khi NODE_ENV='development' hoặc 'test')");
    }
    // Secret ngắn làm JWT brute-force khả thi
    if (s && !devLike && s.length < 32) {
      throw new Error('[CONFIG] JWT_SECRET phải từ 32 ký tự trở lên (hiện tại ' + s.length + ')');
    }
    if (!s) {
      // eslint-disable-next-line no-console -- config bootstrap: logger gây circular dep với env
      console.warn('[CẢNH BÁO] JWT secret mặc định (chỉ dev/test) — hãy đặt JWT_SECRET!');
    }
    return s || 'educenter-dev-secret-change-me';
  })(),

  /** Rate limit đăng nhập: số lần tối đa mỗi cửa sổ. */
  LOGIN_RATE_LIMIT: optionalInt('LOGIN_RATE_LIMIT', 10),
  LOGIN_RATE_WINDOW_MS: optionalInt('LOGIN_RATE_WINDOW_MS', 60_000),

  /**
   * D5: Rate limit đăng nhập theo tài khoản (lớp 2, chống brute-force 1 user
   * cụ thể từ nhiều IP). Mặc định 20 lần / 15 phút / tài khoản.
   */
  LOGIN_ACCOUNT_RATE_LIMIT: optionalInt('LOGIN_ACCOUNT_RATE_LIMIT', 20),
  LOGIN_ACCOUNT_WINDOW_MS: optionalInt('LOGIN_ACCOUNT_WINDOW_MS', 15 * 60 * 1000),

  /**
   * B2: Rate limiter in-memory tách riêng theo từng worker (PM2 cluster).
   * Đặt = số worker để mỗi worker chỉ cho qua max/divisor request — tổng
   * toàn cụm vẫn đúng max đã cấu hình. Mặc định 1 (chạy 1 process).
   */
  RATE_LIMIT_DIVISOR: optionalInt('RATE_LIMIT_DIVISOR', 1),

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
   * Production BẮT BUỘC; dev không đặt thì fallback theo request (req.protocol + host).
   */
  APP_BASE_URL: (() => {
    const v = optional('APP_BASE_URL', '');
    // OPS-5: production không fallback theo Host/req.protocol (sau proxy dễ thành http:// hoặc host giả)
    if (!v && isProd) throw new Error('[CONFIG] Production bắt buộc đặt APP_BASE_URL (vd: https://app.vn)');
    if (v && !/^https?:\/\/[^/]+$/.test(v)) {
      throw new Error(
        `[CONFIG] APP_BASE_URL sai format: "${v}" (đúng: "https://app.vn", không trailing slash)`
      );
    }
    return v;
  })(),

  /**
   * VNPay: TMN code / hash secret lưu per-center trong DB (center_settings, trang Cấu hình thanh toán),
   * KHÔNG đọc từ env. Env chỉ chọn môi trường VNPay (sandbox mặc định / production).
   */
  /** URL cổng thanh toán (redirect phụ huynh). Production: https://pay.vnpay.vn/vpcpay.html */
  VNPAY_PAY_URL: vnpayUrl('VNPAY_PAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  /** URL API merchant (querydr — cron đối soát đơn treo). Production: https://merchant.vnpay.vn/merchant_webapi/api/transaction */
  VNPAY_API_URL: vnpayUrl('VNPAY_API_URL', 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),

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

  /**
   * OPS-4: thư mục lưu file upload (bài nộp, đính kèm). Mặc định <repo>/uploads
   * (src/config hoặc dist/config -> ../../../uploads). Test trỏ sang thư mục tạm.
   */
  UPLOAD_DIR: path.resolve(optional('UPLOAD_DIR', path.resolve(__dirname, '..', '..', '..', 'uploads'))),

  /** Webhook nhận cảnh báo vận hành (backup fail...). Optional. */
  ALERT_WEBHOOK_URL: optional('ALERT_WEBHOOK_URL', ''),

  /** Access token sống bao lâu (chuỗi jwt, vd: '15m', '1h'). Mặc định 15 phút (D2: TTL ngắn để thu hồi nhanh). */
  ACCESS_TOKEN_TTL: (() => {
    const v = optional('ACCESS_TOKEN_TTL', '15m');
    // Fail-fast nếu format sai (vd: '60' thiếu đơn vị) — tránh chạy với TTL không mong muốn
    if (!/^\d+[smhd]$/.test(v)) {
      throw new Error(`[CONFIG] ACCESS_TOKEN_TTL sai format: "${v}" (vd đúng: "1h", "30m")`);
    }
    return v;
  })(),

  /** Refresh token sống bao nhiêu ngày. Mặc định 30 ngày. */
  REFRESH_TOKEN_DAYS: optionalInt('REFRESH_TOKEN_DAYS', 30),

  /**
   * OPS-5: token tĩnh cho Prometheus scrape GET /api/v1/metrics (Authorization: Bearer <token>).
   * Rỗng = tắt (chỉ JWT superadmin). Đặt thì phải >= 32 ký tự.
   */
  METRICS_TOKEN: (() => {
    const v = optional('METRICS_TOKEN', '');
    if (v && v.length < 32) throw new Error('[CONFIG] METRICS_TOKEN phải từ 32 ký tự trở lên');
    return v;
  })(),
} as const;

// Giữ hàm required export để module nào cần biến bắt buộc riêng thì dùng
export { required as requiredEnv };
