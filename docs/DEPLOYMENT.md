# Triển khai Production — EduCenterPro

## Yêu cầu

- Node.js 20+ (khuyến nghị LTS)
- PostgreSQL 16+
- 1GB RAM, 10GB disk

## Các bước

### 1. Cài đặt

```bash
unzip EduCenterPro-full.zip && cd educenter-pro-full
npm install
npm run build
```

### 2. Biến môi trường

Copy `server/.env.example` thành `server/.env` và điền giá trị thật. Biến bắt buộc:

```bash
DATABASE_URL=postgresql://educenter:<mat-khau-manh>@localhost:5432/educenter
JWT_SECRET="$(openssl rand -hex 32)"   # BẮT BUỘC — không đặt thì server từ chối khởi động ở production
NODE_ENV=production
PORT=4000
```

> Không đặt `JWT_SECRET` ở production: server từ chối khởi động.

> **CORS:** đặt `CORS_ORIGIN` thành domain frontend production (vd: `CORS_ORIGIN=https://app.trungtam.vn`). Quên bước này, browser chặn mọi API call từ domain thật.

### 3. Chạy

```bash
npm start
# → http://localhost:4000
```

**Chạy nhiều worker (khuyến nghị production):** dùng PM2 cluster 2 worker để
tận dụng multi-core, tăng ~1,8x throughput:

```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
```

> Rate-limit và permission cache là in-memory nên tách theo worker. Ở 2 worker
> chấp nhận được; scale xa hơn thì cần Redis.

Lần chạy đầu tiên tự tạo schema PostgreSQL + chạy migrations theo version.
Seed demo **mặc định TẮT** (`SEED_DEMO=false`) — chỉ bật cho môi trường dev/test.

Tài khoản superadmin khởi tạo: chạy `npx tsx scripts/create-superadmin.ts <username> <password>` (mật khẩu 8+ ký tự). Không dùng SEED_DEMO=true trên production.

### 4. Reverse proxy (Nginx mẫu)

```nginx
server {
  listen 443 ssl;
  server_name trungtam.example.com;
  ssl_certificate /etc/ssl/cert.pem;
  ssl_certificate_key /etc/ssl/key.pem;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

> Chạy sau proxy: đặt `TRUST_PROXY=true` để rate limit đọc IP thật từ `X-Forwarded-For`.

### 5. Sau khi lên production

1. **Đổi mật khẩu** các tài khoản khởi tạo ngay.
2. **Backup DB**: app đã có backup tự động (`BACKUP_CRON`, mặc định 2h sáng, giữ `BACKUP_KEEP` bản,
   có advisory lock + verify file dump sau mỗi lần backup, retry 2 lần cách 15 phút khi fail).
   **RPO 24h**: nếu DB chết lúc 18h, mất ~16h dữ liệu kể từ backup 2h sáng. Trước khi restore,
   kiểm tra timestamp bản backup mới nhất (`ls -lt backups/`) để biết phải nhập tay lại dữ liệu nào.
   Nếu backup fail cả 3 lần, chỉ có log ERROR — nên giám sát log hoặc đặt `ALERT_WEBHOOK_URL`
   (POST JSON khi backup fail).
   **Quan trọng**: backup mặc định nằm cùng disk với server (`./backups`, đã gitignored).
   Production PHẢI có bản offsite — đồng bộ thư mục backups ra S3/rclone mỗi đêm:
   ```bash
   0 4 * * * rclone sync /opt/educenter/backups s3:/my-bucket/educenter-backups --min-age 1d
   ```
   Ngoài ra nên có pg_dump ra nơi khác:
   ```bash
   0 3 * * * pg_dump -Fc $DATABASE_URL -f /backup/educenter-$(date +\%F).dump
   ```
   Drill restore hàng quý: `pg_restore --clean -d educenter_restore <file>` (xem `ops/GO-LIVE.md`).
3. **Giám sát nhất quán tài chính**: app tự chạy `checkFinancialConsistency()` mỗi giờ,
   có lệch thì log ERROR — đấu nối log này vào hệ cảnh báo (vd: Telegram/Slack webhook).
4. **VNPay production**: đặt `VNPAY_URL=https://www.vnpayment.vn/paymentv2/vpcpay.html`,
   `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` thật (env hoặc
   trang `/app/cau-hinh-thanh-toan`).
5. **Zalo OA**: nhập `ZALO_OA_ID` + `ZALO_ACCESS_TOKEN` thật; template ZNS mới cần
   được Zalo duyệt trước khi gửi thật (để trống = chế độ demo, chỉ ghi log).

## Tính năng vận hành đã có

- **Audit log**: mọi thao tác tiền bạc và xóa quan trọng được ghi `audit_logs` (xem `/app/nhat-ky`).
- **Backup tự động**: theo lịch cron trong app.
- **Health check**: `GET /api/health` (public, có ping DB), `GET /api/v1/health` (chi tiết, cần quyền).
- **Metrics**: `GET /api/v1/metrics` (Prometheus).
- **Rate limiting**: login 10 req/60s/IP (+ giới hạn riêng theo tài khoản);
  API chung 300 req/15ph/tài khoản (IP nếu chưa đăng nhập); ghi 60 req/15ph.
  Mọi giới hạn đều tính **per-worker**: với PM2 cluster N worker, đặt
  `RATE_LIMIT_DIVISOR=N` (ecosystem.config.js đã đặt 2) để tổng toàn cụm
  không vượt max cấu hình.

## Giới hạn đã biết

- Rate limiter và event bus dùng bộ nhớ trong (in-memory): phù hợp chạy 1 instance.
  Khi scale multi-instance, cần thay bằng Redis. Với PM2 cluster, quota
  rate-limit được chia đều cho các worker qua `RATE_LIMIT_DIVISOR`
  (tổng toàn cụm = max cấu hình).
