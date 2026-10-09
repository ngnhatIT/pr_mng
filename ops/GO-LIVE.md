# EduCenterPro — Còn lại gì để go-live?

Cập nhật: 2026-10-08 (sau đợt fix bảo mật QC chuyên nghiệp)

## Đã xong hôm nay (QC fix, đã verify bằng curl)
1. **Phân quyền API**: phụ huynh không còn gọi được API staff (403), giáo viên không xóa được học viên (`staffOnly` trên POST/PUT/DELETE students), teacher vẫn truy cập đúng phạm vi lớp của mình.
2. **Chống brute force**: giới hạn 10 request/60s/IP cho login admin, login phụ huynh và đăng ký (`server/src/middleware/rateLimit.ts`).
3. **JWT secret**: đọc từ biến môi trường `JWT_SECRET`, có cảnh báo khi chạy dev không đặt.

## Còn lại — ưu tiên từ cao xuống thấp
1. **Đổi mật khẩu demo** (admin / teacher1 / root / 0900000001 đều là `123456`): đặt mật khẩu mạnh trên production; production không seed tài khoản demo.
2. **Backup database tự động** → đã có script `ops/backup-db.js` (đã test):
   - Backup online không cần tắt app, tự verify `integrity_check`, giữ 7 bản gần nhất.
   - Chạy thử: `node ops/backup-db.js` (mặc định lưu vào `server/backups/`).
   - Chạy tự động mỗi ngày 2h sáng trên server, thêm vào crontab:
     ```
     0 2 * * * /usr/bin/node /opt/educenter-pro-full/ops/backup-db.js >> /var/log/educenter-backup.log 2>&1
     ```
3. **JWT_SECRET**: đặt env thật trên production (ví dụ chuỗi ngẫu nhiên 32+ ký tự).
4. **VNPay**: đang sandbox → đổi sang key production trước khi nhận tiền thật.
5. **Zalo ZNS**: các template nhắc học phí mới hiện chỉ log ở demo mode → đăng ký template thật với Zalo OA.
6. **Audit log**: chưa có — nên có để truy vết ai sửa/xóa dữ liệu (nice-to-have cho go-live).
7. **HTTPS**: production nên chạy sau reverse proxy có TLS (Nginx/Caddy) — chưa có hướng dẫn deploy.
8. **PostgreSQL**: đã dùng PostgreSQL 16+ (pool 20 connections), sẵn sàng cho nhiều trung tâm đồng thời.

## Khôi phục database khi sự cố
```
# 1. Dừng app
# 2. pg_restore -d $DATABASE_URL /backup/educenter-YYYYMMDD.dump
# 3. Khởi động lại app
```
