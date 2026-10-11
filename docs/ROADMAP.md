# Roadmap — nâng cấp chuẩn quốc tế (bắt đầu 2026-10-11, nhánh `upgrade-intl`)

Nguồn: 3 audit (tính năng so với Teachworks/TutorBird/Classe365, khả năng mở rộng backend, UI/UX + a11y).
Đánh dấu `[x]` khi xong (kèm commit). Mỗi vòng: làm 1 gói → test server+client → kiểm trên trình duyệt → commit.

## Gói 1 — Xuất dữ liệu + sửa nhanh UI quốc tế (S)
- [x] Xuất CSV (học viên, hóa đơn, công nợ, bảng lương) — `GET /api/v1/exports/*.csv`, quyền `reports.export`
- [x] Tương phản WCAG: viền input ≥3:1, badge danger, banner online
- [x] Số nhiều tiếng Anh (`_one`) + test locales chặn thiếu
- [x] Ngày theo locale (`Intl`, en "Oct 9, 2026"), helper `appLocale()`; tiền giữ "1,000,000 VND"
- [x] Theme: theo OS tới khi người dùng tự chọn (chưa có nút "System" riêng)
- [x] Dark mode rò màu (`.alert-warning`, `.rubric-banner`)
- [x] Focus `main` khi đổi trang; toast lỗi `role=alert`, dừng khi hover

## Gói 2 — Lịch & vận hành buổi học (M)
- [x] Trang Lịch `/app/schedule` (tuần/tháng, lọc giáo viên/phòng, mobile thành danh sách)
- [x] Dạy thay / đổi phòng / đổi giờ / dời buổi từng buổi (migration v26; giữ `UNIQUE(class_id,date)`, dời = hủy mềm gốc + tạo buổi mới)

## Gói 3 — Thông báo (M)
- [x] Bảng `notifications` + chuông in-app (nhân sự, GV, phụ huynh) + trang `/parent/notifications`, thông báo chung `/app/announcements` (migration v27)
- [ ] Kênh email (SMTP, tùy chọn) + tự đặt lại mật khẩu qua email; chuyển `notifyParents` sang listener sự kiện
- [x] ~~Refresh token ân hạn~~: đã có ân hạn 30s cho 2 tab cùng refresh (B4). Còn lại: response refresh bị hủy rồi dùng lại cookie cũ sau >30s bị coi là trộm token -> đăng xuất. Chấp nhận (đánh đổi bảo mật); gặp chủ yếu khi dev reload HMR.

## Gói 4 — Tài chính (M)
- [ ] Dòng hóa đơn + giảm giá (anh chị em/khuyến mãi)
- [x] Tạo hóa đơn học phí tháng hàng loạt (xem trước, chạy lại an toàn)
- [x] Biên lai in (lưu PDF qua hộp thoại in của trình duyệt) có dòng + giảm trừ; PDF phía server khi cần gửi email

## Gói 5 — Nhập liệu & điều hướng (S–M)
- [x] Nhập học viên từ CSV (kiểm tra trước, lỗi theo dòng có mã dịch được, nhận file Xuất CSV của app)
- [x] Tìm nhanh Ctrl/Cmd+K (trang theo quyền, học viên, lớp; combobox ARIA)
- [x] URL tiếng Anh cho mọi trang + chuyển hướng URL cũ giữ query (VNPay trả về /parent/payment-result)
- [ ] Breadcrumb chung + tiêu đề topbar ở trang chi tiết, menu tài khoản trên topbar
- [x] Tìm kiếm không dấu phía server (hàm f_unaccent, migration v29) cho học viên, hóa đơn, lead, lớp, bài tập, ngân hàng câu hỏi
- [x] Sắp xếp cột bảng: parseSort allowlist (server) + SortHeader aria-sort, áp cho Học viên và Hóa đơn; sort trên URL

## Gói 6 — API & bảo mật chuẩn quốc tế (S–M)
- [ ] Mã lỗi cụ thể + `details[]` theo field → client dịch theo code
- [x] Test đối chiếu route Express ↔ OpenAPI (app.routes.test.ts) + bổ sung 8 operation còn thiếu
- [ ] 2FA TOTP cho nhân sự
- [ ] Xuất/ẩn danh dữ liệu học viên (GDPR/PDPL)

## Sau đó (L — cần quyết định kinh doanh)
Đa tiền tệ/múi giờ theo trung tâm, cổng thanh toán quốc tế, gói buổi trả trước, nhắn tin PH↔GV, API key + webhook (outbox), lưu file S3.
