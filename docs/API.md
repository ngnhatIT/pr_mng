# API Reference — EduCenterPro

Base URL: `http://localhost:4000/api` (production) hoặc `http://localhost:5173/api` (dev proxy).

Quy ước chung:
- Auth: header `Authorization: Bearer <token>` (trừ các endpoint public).
- Lỗi trả về: `{ "error": "<message tiếng Việt>", "code": "<MÃ_LỖI>" }`.
- **Pagination**: mọi API danh sách hỗ trợ `?page=1&limit=20` (limit tối đa 100),
  trả về envelope `{ data: [...], pagination: { page, limit, total, totalPages } }`.

## Public (không cần token)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/health` | Health check |
| POST | `/auth/login` | Đăng nhập staff (admin/teacher) |
| POST | `/parent/register` | Phụ huynh đăng ký bằng SĐT |
| POST | `/parent/login` | Phụ huynh đăng nhập bằng SĐT |
| GET | `/public/lookup?phone=` | Tra cứu học phí công khai theo SĐT |
| GET | `/payments/vnpay-return` | VNPay callback (redirect về `/parent/thanh-toan-ket-qua`) |

## Staff (admin / teacher)

| Method | Endpoint | Mô tả | Ghi chú |
|--------|----------|-------|---------|
| GET/POST | `/students` | Danh sách / tạo học viên | POST/PUT/DELETE cần `staffOnly` |
| GET/PUT/DELETE | `/students/:id` | Chi tiết (kèm lớp + hóa đơn) / sửa / xóa | Xóa cascade toàn bộ dữ liệu liên quan |
| GET/POST | `/classes` | Danh sách / tạo lớp | Kiểm tra trùng lịch phòng |
| GET/PUT/DELETE | `/classes/:id` | Chi tiết / sửa / xóa lớp | |
| POST | `/classes/:id/enroll` | Ghi danh học viên | 201 |
| DELETE | `/classes/enrollments/:enrollmentId` | Hủy ghi danh | |
| GET/POST | `/sessions` | Buổi học của lớp | Teacher chỉ thấy lớp mình dạy |
| POST | `/sessions/:id/attendance` | Lưu điểm danh | |
| POST | `/sessions/generate-code` | Sinh mã check-in 6 số | |
| GET/POST | `/invoices` | Hóa đơn / tạo hóa đơn | |
| GET | `/invoices/debt` | Báo cáo công nợ | |
| POST | `/invoices/:id/payments` | Ghi nhận thu tiền | Chặn thu vượt số nợ |
| POST | `/invoices/:id/apply-credit` | Trừ credit giới thiệu | |
| GET | `/payments/pending` | Khoản chờ duyệt | staff |
| POST | `/payments/pending/:id/approve` | Duyệt thanh toán | Gửi Zalo cho PH + ghi audit |
| POST | `/payments/pending/:id/reject` | Từ chối | Ghi audit |
| GET/PUT | `/payments/config` | Cấu hình thanh toán | admin, hashsecret bị che |
| GET | `/audit-logs` | Nhật ký hoạt động | admin, filter action/entity/from/to + pagination |
| GET/POST | `/teachers`, `/rooms`, `/leads`, `/trials`, `/leaves`, `/grades`, `/homework`, `/referrals`, `/reviews` | CRUD các domain | |
| GET | `/dashboard` | Số liệu tổng quan | |
| GET | `/payroll?month=` | Bảng lương giáo viên | Tự động từ điểm danh |
| GET/PUT | `/zalo/*` | Cấu hình + lịch sử nhắc Zalo | |

## Phụ huynh (parent token — CHỈ `/api/parent/*`)

Token phụ huynh bị chặn ở mọi API staff (`denyParents` → 403).

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/parent/children` | Danh sách con đã liên kết |
| POST | `/parent/link-student` | Liên kết thêm con bằng mã HV |
| GET | `/parent/children/:id/overview` | Tổng quan 1 con (5 tab) |
| GET | `/parent/children/:id/grades` | Sổ liên lạc điện tử |
| POST | `/parent/vietqr` | Tạo mã VietQR thanh toán |
| POST | `/parent/vnpay` | Tạo URL thanh toán VNPay |
| POST | `/parent/claim-transfer` | Báo đã chuyển khoản (chờ duyệt) |
| GET/POST | `/parent/leaves` | Xin nghỉ / danh sách đơn nghỉ |
| GET | `/parent/referral` | Mã giới thiệu + credit |
| GET/POST | `/parent/reviews` | Đánh giá trung tâm |

## Rate limiting

- `/auth/login`, `/parent/login`, `/parent/register`: 10 req / 60s / IP → 429.
- `/public/lookup`: 30 req / 60s / IP.
