# API Reference — EduCenterPro

> Nguồn chính xác nhất: `server/src/docs/openapi.yaml` (Swagger, serve tại `/api-docs` khi chạy server).
> Tài liệu này mô tả quy ước chung và các luồng quan trọng.

Base URL: `http://localhost:4000/api/v1` (legacy `/api` vẫn hoạt động, kèm header `Deprecation`).

Quy ước chung:

- Auth: header `Authorization: Bearer <access_token>` (trừ endpoint public).
- Lỗi: `{ "error": "<message tiếng Việt>", "code": "<MÃ_LỖI>" }`.
- **Pagination**: `?page=1&limit=20` (limit tối đa 100) → `{ data: [...], pagination: { page, limit, total, totalPages } }`.
- **Tạo resource**: `201`. **Xóa/action**: `200 + { ok: true }`. **Không tìm thấy**: `404`. **Xung đột**: `409`.

## Auth flow (staff + parent)

1. `POST /auth/login` (staff) hoặc `POST /parent/login` (phụ huynh) → `{ token, refresh_token, expires_in, user }`.
2. `token` là JWT sống **1 giờ**. Hết hạn → client tự gọi `POST /auth/refresh` (hoặc `/parent/refresh`) với `refresh_token` để lấy cặp mới.
3. Refresh token là opaque token, sống **30 ngày**, **rotation**: mỗi lần dùng sẽ cấp token mới và vô hiệu token cũ. Dùng lại token cũ → coi như bị đánh cắp, **thu hồi cả chuỗi** (reuse detection).
4. `POST /auth/logout` (hoặc `/parent/logout`) thu hồi refresh token server-side.

## Phân quyền (RBAC)

61 permissions theo module, gán cho role với scope `own` / `center` / `all` (scope mạnh nhất thắng).

- `superadmin`: toàn hệ thống. `admin`: toàn trung tâm. `staff`: vận hành (không xóa hệ thống). `teacher`: scope `own`.
- API: `GET /roles`, `POST /roles`, `PUT /roles/:id/permissions`, `POST /roles/assign`, `GET /roles/me/permissions` (client dùng để ẩn/hiện menu).
- Token phụ huynh có `kind: 'parent'` — bị chặn 403 ở mọi API staff.

## Public (không cần token)

| Method | Endpoint                 | Mô tả                         |
| ------ | ------------------------ | ----------------------------- |
| GET    | `/health`                | Health check                  |
| POST   | `/auth/login`            | Đăng nhập staff               |
| POST   | `/parent/register`       | Phụ huynh đăng ký bằng SĐT    |
| POST   | `/parent/login`          | Phụ huynh đăng nhập bằng SĐT  |
| POST   | `/public/trials`         | Đăng ký học thử               |
| POST   | `/public/leads`          | Để lại thông tin tư vấn       |
| GET    | `/payments/vnpay-return` | VNPay return URL (idempotent) |

## Staff — tài chính (luồng tiền)

| Method   | Endpoint                        | Mô tả                                                                          |
| -------- | ------------------------------- | ------------------------------------------------------------------------------ |
| GET/POST | `/invoices`                     | Danh sách / tạo hóa đơn                                                        |
| GET      | `/invoices/debt`                | Báo cáo công nợ                                                                |
| POST     | `/invoices/:id/payments`        | Thu tiền — chặn thu vượt, lock chống race → `201`                              |
| POST     | `/invoices/:id/refund`          | Hoàn tiền (quyền `payments.refund`) — ghi payment âm, tối đa số đã thu → `201` |
| POST     | `/invoices/:id/apply-credit`    | Trừ credit giới thiệu → `201`                                                  |
| GET      | `/payments/pending`             | Khoản chờ duyệt                                                                |
| POST     | `/payments/pending/:id/approve` | Duyệt — chống double-approve, gửi Zalo, ghi audit                              |
| POST     | `/payments/pending/:id/reject`  | Từ chối — ghi audit                                                            |
| GET/PUT  | `/payments/config`              | Cấu hình thanh toán (hashsecret bị che khi đọc)                                |

## Staff — vận hành

| Method              | Endpoint                                       | Mô tả                                                       |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| GET/POST/PUT/DELETE | `/students`, `/classes`, `/teachers`, `/rooms` | CRUD (xóa học viên cascade, cần quyền)                      |
| POST                | `/classes/:id/enroll`                          | Ghi danh — chặn vượt sĩ số → `201`                          |
| DELETE              | `/classes/enrollments/:enrollmentId`           | Hủy ghi danh                                                |
| POST                | `/sessions/:id/attendance`                     | Lưu điểm danh                                               |
| POST                | `/trials/:id/convert`, `/leads/:id/convert`    | Chuyển thành học viên — atomic, chống convert trùng → `201` |
| GET                 | `/dashboard`                                   | Số liệu tổng quan                                           |
| GET                 | `/payroll?month=`                              | Bảng lương — 1 query GROUP BY                               |
| GET                 | `/audit-logs`                                  | Nhật ký kiểm toán (filter + pagination)                     |
| GET/PUT             | `/zalo/*`                                      | Cấu hình + lịch sử nhắc Zalo                                |

## Phụ huynh (parent token — CHỈ `/api/v1/parent/*`)

| Method   | Endpoint                              | Mô tả                                           |
| -------- | ------------------------------------- | ----------------------------------------------- |
| GET      | `/parent/children`                    | Danh sách con đã liên kết                       |
| POST     | `/parent/link`                        | Liên kết con (cần SĐT + ngày sinh đúng) → `201` |
| GET      | `/parent/children/:id/overview`       | Tổng quan 1 con                                 |
| GET      | `/parent/children/:id/grades`         | Sổ liên lạc điện tử                             |
| POST     | `/parent/invoices/:id/vietqr`         | Tạo mã VietQR → `201`                           |
| POST     | `/parent/invoices/:id/vnpay`          | Tạo URL VNPay → `201`                           |
| POST     | `/parent/invoices/:id/claim-transfer` | Báo đã chuyển khoản (chờ duyệt)                 |
| GET/POST | `/parent/leaves`                      | Xin nghỉ — chặn trùng ngày → `409`              |
| GET      | `/parent/referral`                    | Mã giới thiệu + credit                          |
| GET/POST | `/parent/reviews`                     | Đánh giá trung tâm                              |
| POST     | `/parent/homework/:id/complete`       | Đánh dấu hoàn thành → `201`                     |
| POST     | `/parent/homework/:id/submit`         | Nộp bài (file) → `201`                          |
| POST     | `/parent/homework/:id/quiz/submit`    | Nộp quiz → `201`                                |

## Rate limiting

- `/auth/login`, `/parent/login`, `/parent/register`: 10 req / 60s / IP → `429`.
- Ghi (POST/PUT/DELETE) staff: 120 req / 60s / IP.

## Idempotency (chống double-submit)

- POST tạo phiếu thu (`/invoices/:id/payments`) hỗ trợ header `Idempotency-Key: <uuid>`.
- Client giữ nguyên key cho cùng một ý định thanh toán (không sinh mới khi retry).
- Server trả lại response đã lưu nếu key trùng (không tạo payment mới).
