# EduCenterPro — Còn lại gì để go-live?

Cập nhật: 2026-10-11. Nguồn chuẩn cho env, deploy, nâng cấp/rollback: `docs/DEPLOYMENT.md` — file này chỉ là checklist go-live, không lặp lại hướng dẫn cấu hình.

## Đã xong (QC fix, đã verify bằng curl)
1. **Phân quyền API**: phụ huynh không còn gọi được API staff (403), giáo viên không xóa được học viên (RBAC `requirePermission('students.delete')`, role teacher không có quyền này), teacher vẫn truy cập đúng phạm vi lớp của mình.
2. **Chống brute force**: giới hạn 10 request/60s/IP cho login admin, login phụ huynh và đăng ký (`server/src/middleware/rateLimit.ts`).
3. **JWT secret**: bắt buộc `JWT_SECRET` (tối thiểu 32 ký tự) trừ khi `NODE_ENV` là `development`/`test`; thiếu hoặc ngắn thì server từ chối khởi động.

## Còn lại — ưu tiên từ cao xuống thấp
1. **Đổi mật khẩu demo** (admin / teacher1 / root / 0900000001 đều là `123456`): đặt mật khẩu mạnh trên production; production không seed tài khoản demo.
2. **Backup database tự động** → đã có sẵn trong app, không cần script ngoài:
   - App tự chạy `pg_dump -Fc` (custom format, nén, online không cần tắt app) theo lịch `BACKUP_CRON` (mặc định `0 2 * * *`, múi giờ Asia/Ho_Chi_Minh), giữ `BACKUP_KEEP` bản mới nhất (mặc định 7).
   - File backup: `./backups/educenter-backup-YYYYMMDD-HHMMSS.dump` (thư mục làm việc của server).
   - ⚠️ pg_dump KHÔNG chứa file upload (`UPLOAD_DIR`, mặc định `<repo>/uploads`) — sao lưu/đồng bộ offsite thư mục này cùng `./backups` (xem `docs/DEPLOYMENT.md`).
   - Mỗi lần backup thành công/thất bại đều ghi log — **giám sát log `Backup định kỳ` để phát hiện backup fail** (backup fail không crash app).
   - ⚠️ Script cũ `ops/archive/backup-db.js` là thời SQLite, **KHÔNG dùng nữa** (backup file `server/data.db` không còn tồn tại).
   - Drill khôi phục định kỳ (khuyến nghị mỗi quý): restore 1 bản backup vào database scratch để verify file dùng được:
     ```
     createdb educenter_restore
     pg_restore -d postgres://USER:PASS@localhost:5432/educenter_restore ./backups/educenter-backup-<stamp>.dump
     ```
3. **Env production** (`JWT_SECRET` 32+ ký tự, `APP_BASE_URL`, ...): xem `docs/DEPLOYMENT.md` bước 2.
4. **VNPay**: đang sandbox → trước khi nhận tiền thật: đặt `VNPAY_PAY_URL`/`VNPAY_API_URL` production trong `server/.env`, và nhập TMN code + hash secret thật per-center ở trang cấu hình thanh toán (chi tiết: `docs/DEPLOYMENT.md` bước 5.4).
5. **Zalo ZNS**: các template nhắc học phí mới hiện chỉ log ở demo mode → đăng ký template thật với Zalo OA; OA ID/token nhập per-center trong app (không qua env).
6. **Audit log**: đã có (`audit_logs`, trang `/app/nhat-ky`; lịch sử tiền `payment_history`/`invoice_history` ghi cả `changed_by` + `changed_by_role`).
7. **HTTPS**: chạy sau reverse proxy có TLS — xem mẫu Nginx trong `docs/DEPLOYMENT.md` (có `client_max_body_size 12m`, `X-Forwarded-Proto`).
8. **PostgreSQL**: đã dùng PostgreSQL 16+ (pool 20 connections), sẵn sàng cho nhiều trung tâm đồng thời.

## Khôi phục database khi sự cố
```
# 1. Dừng app
# 2. Restore bản backup mới nhất vào database chính:
pg_restore --clean -d "$DATABASE_URL" ./backups/educenter-backup-<stamp>.dump
# 3. Khôi phục thư mục UPLOAD_DIR từ bản offsite cùng thời điểm
# 4. Khởi động lại app
```
Lùi schema sau một lần nâng cấp lỗi (không restore): `server/scripts/migrate-down.ts` — xem "Nâng cấp phiên bản" trong `docs/DEPLOYMENT.md`.
