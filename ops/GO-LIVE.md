# EduCenterPro — Còn lại gì để go-live?

Cập nhật: 2026-10-09 (backup tự động bằng pg_dump trong app; tài khoản demo chỉ seed khi SEED_DEMO=true)

## Đã xong hôm nay (QC fix, đã verify bằng curl)
1. **Phân quyền API**: phụ huynh không còn gọi được API staff (403), giáo viên không xóa được học viên (`staffOnly` trên POST/PUT/DELETE students), teacher vẫn truy cập đúng phạm vi lớp của mình.
2. **Chống brute force**: giới hạn 10 request/60s/IP cho login admin, login phụ huynh và đăng ký (`server/src/middleware/rateLimit.ts`).
3. **JWT secret**: đọc từ biến môi trường `JWT_SECRET`, có cảnh báo khi chạy dev không đặt.

## Còn lại — ưu tiên từ cao xuống thấp
1. **Đổi mật khẩu demo** (admin / teacher1 / root / 0900000001 đều là `123456`): đặt mật khẩu mạnh trên production; production không seed tài khoản demo.
2. **Backup database tự động** → đã có sẵn trong app, không cần script ngoài:
   - App tự chạy `pg_dump -Fc` (custom format, nén, online không cần tắt app) theo lịch `BACKUP_CRON` (mặc định `0 2 * * *`, múi giờ Asia/Ho_Chi_Minh), giữ `BACKUP_KEEP` bản mới nhất (mặc định 7).
   - File backup: `./backups/educenter-backup-YYYYMMDD-HHMMSS.dump` (thư mục làm việc của server).
   - Mỗi lần backup thành công/thất bại đều ghi log — **giám sát log `Backup định kỳ` để phát hiện backup fail** (backup fail không crash app).
   - ⚠️ Script cũ `ops/backup-db.js` là thời SQLite, **KHÔNG dùng nữa** (backup file `server/data.db` không còn tồn tại).
   - Drill khôi phục định kỳ (khuyến nghị mỗi quý): restore 1 bản backup vào database scratch để verify file dùng được:
     ```
     createdb educenter_restore
     pg_restore -d postgres://USER:PASS@localhost:5432/educenter_restore ./backups/educenter-backup-<stamp>.dump
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
# 2. Restore bản backup mới nhất vào database chính:
pg_restore --clean -d "$DATABASE_URL" ./backups/educenter-backup-<stamp>.dump
# 3. Khởi động lại app
```
