# Triển khai Production — EduCenterPro

## Yêu cầu

- Node.js 20+ (khuyến nghị LTS)
- 1GB RAM, 10GB disk (PostgreSQL 16+)

## Các bước

### 1. Cài đặt

```bash
unzip EduCenterPro-full.zip && cd educenter-pro-full
npm install
npm run build
```

### 2. Biến môi trường (bắt buộc)

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # BẮT BUỘC — không dùng default
export NODE_ENV=production
export PORT=4000
```

> Không đặt `JWT_SECRET` ở production: server từ chối khởi động.

### 3. Chạy

```bash
npm start
# → http://localhost:4000
```

Lần chạy đầu tiên tự tạo schema PostgreSQL (44 bảng + 36 trigger) + seed tài khoản demo.

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
  }
}
```

### 5. Sau khi lên production

1. **Đổi mật khẩu demo ngay**: `admin`, `teacher1`, `root`, phụ huynh `0900000001`.
2. **Backup DB**: cron pg_dump hàng ngày
   ```bash
   0 2 * * * pg_dump -Fc $DATABASE_URL -f /backup/educenter-$(date +\%F).dump
   ```
3. **VNPay production**: đổi `VNPAY_PAY_URL` trong `server/src/services/vnpay.ts`
   sang `https://www.vnpayment.vn/paymentv2/vpcpay.html` + cấu hình TMN code/hash secret
   thật tại `/app/cau-hinh-thanh-toan`.
4. **Zalo OA**: nhập access token thật tại `/app/zalo`; các template ZNS mới cần
   được Zalo duyệt trước khi gửi thật (hiện tại log ở chế độ demo).

## Giới hạn đã biết

- PostgreSQL: sẵn sàng cho đa trung tâm đồng thời; khi cần scale lớn hơn,
  migrate sang Postgres (tầng `db/` đã tách riêng, service không dính SQL dialect).
- Chưa có audit log tập trung và backup tự động trong app.
