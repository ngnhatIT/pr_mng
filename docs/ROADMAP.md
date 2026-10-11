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
- [ ] Bảng `notifications` + chuông/inbox in-app (staff + phụ huynh), thông báo chung (announcement)
- [ ] Kênh email (SMTP, tùy chọn) + tự đặt lại mật khẩu qua email; chuyển `notifyParents` sang listener sự kiện

## Gói 4 — Tài chính (M)
- [ ] Dòng hóa đơn + giảm giá (anh chị em/khuyến mãi)
- [ ] Tạo hóa đơn hàng loạt theo tháng
- [ ] Phiếu thu PDF/in đẹp

## Gói 5 — Nhập liệu & điều hướng (S–M)
- [ ] Nhập học viên từ CSV (xem trước + báo lỗi từng dòng)
- [ ] Command palette Ctrl+K, breadcrumb chung, menu tài khoản trên topbar, URL tiếng Anh + redirect
- [ ] Sắp xếp cột bảng (`sort` allowlist server + `aria-sort`)

## Gói 6 — API & bảo mật chuẩn quốc tế (S–M)
- [ ] Mã lỗi cụ thể + `details[]` theo field → client dịch theo code
- [ ] Test đối chiếu route Express ↔ OpenAPI
- [ ] 2FA TOTP cho nhân sự
- [ ] Xuất/ẩn danh dữ liệu học viên (GDPR/PDPL)

## Sau đó (L — cần quyết định kinh doanh)
Đa tiền tệ/múi giờ theo trung tâm, cổng thanh toán quốc tế, gói buổi trả trước, nhắn tin PH↔GV, API key + webhook (outbox), lưu file S3.
