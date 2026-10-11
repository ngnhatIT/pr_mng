# API Reference — EduCenterPro

> Nguồn chính xác nhất: `server/src/docs/openapi.yaml` (Swagger, serve tại `/api/docs` khi chạy server ở dev — production không mount).
> Tài liệu này mô tả quy ước chung và các luồng quan trọng.

Base URL: `http://localhost:4000/api/v1` (legacy `/api` vẫn hoạt động, kèm header `Deprecation`).

Quy ước chung:

- Auth: header `Authorization: Bearer <access_token>` (trừ endpoint public).
- Lỗi: `{ "error": "<message tiếng Việt>", "code": "<MÃ_LỖI>" }`.
- **Pagination**: `?page=1&limit=20` (limit tối đa 100) → `{ data: [...], pagination: { page, limit, total, totalPages } }`.
- **Tạo resource**: `201`. **Xóa/action**: `200 + { ok: true }`. **Không tìm thấy**: `404`. **Xung đột**: `409`.

## Auth flow (staff + parent)

1. `POST /auth/login` (staff) hoặc `POST /parent/login` (phụ huynh) → body `{ token, expires_in, user }`; refresh token
   được set qua **cookie HttpOnly** (`SameSite=Strict`, path `/api/v1/auth` hoặc `/api/v1/parent`), không nằm trong body.
2. `token` là JWT sống **15 phút** (`ACCESS_TOKEN_TTL`). Hết hạn → client gọi `POST /auth/refresh` (hoặc `/parent/refresh`);
   trình duyệt tự gửi cookie refresh, server trả access token mới + set cookie mới.
3. Refresh token là opaque token, sống **30 ngày**, **rotation**: mỗi lần dùng sẽ cấp token mới và vô hiệu token cũ. Dùng lại token cũ → coi như bị đánh cắp, **thu hồi cả chuỗi** (reuse detection).
4. `POST /auth/logout` (hoặc `/parent/logout`) thu hồi refresh token server-side.
5. `POST /auth/logout-all` (hoặc `/parent/logout-all`): thu hồi mọi phiên **khác**, giữ phiên hiện tại → `{ ok, token }`
   (access token mới thay token cũ).
6. `GET /auth/me`: thông tin user đang đăng nhập (kèm tên trung tâm).
7. **Mật khẩu tạm (v25)**: tài khoản vừa được admin đặt lại mật khẩu (`/auth/reset-requests/:id/process`) hoặc do admin
   tạo kèm mật khẩu (tài khoản giáo viên, admin trung tâm mới) có `must_change_password: true` trong `user` của
   `/auth/login`, `/auth/refresh`, `/auth/me` (phụ huynh: `parent` của `/parent/login`, `user` của `/parent/refresh`).
   Khi cờ bật, mọi API cần đăng nhập trả `403 { code: 'PASSWORD_CHANGE_REQUIRED' }`, trừ `GET /auth/me`,
   `POST /auth/change-password`, `POST /parent/change-password` và `POST /auth/logout-all` / `/parent/logout-all` (chỉ
   giảm truy cập; token mới vẫn mang cờ) — refresh/logout không cần access token nên vẫn dùng được.
   Đổi mật khẩu xong cờ về `false` và access token cũ bị thu hồi (401 `TOKEN_REVOKED`) → client gọi refresh để lấy token mới.

## Phân quyền (RBAC)

61 permissions theo module, gán cho role với scope `own` / `center` / `all` (scope mạnh nhất thắng).

- `superadmin`: toàn hệ thống. `admin`: toàn trung tâm. `staff`: vận hành (không xóa hệ thống). `teacher`: scope `own`.
- API: `GET /roles`, `POST /roles`, `PUT /roles/:id/permissions`, `POST /roles/assign`, `GET /roles/me/permissions` (client dùng để ẩn/hiện menu).
- Token phụ huynh có `kind: 'parent'` — bị chặn 403 ở mọi API staff.
- Tenant: user thường luôn thao tác trong trung tâm của mình; tài khoản không phải superadmin mà chưa gán trung tâm bị
  `403 NO_CENTER` (không còn rơi về trung tâm mặc định). Superadmin đọc toàn hệ thống; thêm `?center_id=<id>` để thao tác
  như một trung tâm cụ thể — các thao tác GHI dữ liệu tenant bắt buộc chỉ rõ (query hoặc body `center_id`, thiếu → `400 CENTER_REQUIRED`).

## Public (không cần token)

| Method | Endpoint                   | Mô tả                                                                            |
| ------ | -------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/live`, `/api/health` | Liveness / readiness (ngoài `/api/v1`; `/api/v1/health` chi tiết cần superadmin) |
| POST   | `/auth/login`              | Đăng nhập staff                                                                  |
| POST   | `/parent/register`         | Phụ huynh đăng ký bằng SĐT                                                       |
| POST   | `/parent/login`            | Phụ huynh đăng nhập bằng SĐT                                                     |
| POST   | `/public/trials`           | Đăng ký học thử                                                                  |
| POST   | `/public/leads`            | Để lại thông tin tư vấn                                                          |
| GET    | `/payments/vnpay-return`   | VNPay return URL (idempotent)                                                    |

`/public/*` xác định trung tâm theo subdomain của `Host`. Host không khớp: chỉ khi hệ thống có đúng 1 trung tâm mới dùng trung tâm đó, nhiều trung tâm → `404`.

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

| Method              | Endpoint                                       | Mô tả                                                                                                    |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET/POST/PUT/DELETE | `/students`, `/classes`, `/teachers`, `/rooms` | CRUD (xóa học viên cascade, cần quyền)                                                                   |
| POST                | `/classes/:id/enroll`                          | Ghi danh — chặn vượt sĩ số → `201`                                                                       |
| DELETE              | `/classes/enrollments/:enrollmentId`           | Hủy ghi danh                                                                                             |
| POST                | `/sessions/:id/attendance`                     | Lưu điểm danh                                                                                            |
| —                   | (buổi học)                                     | Tự sinh khi tạo/sửa lớp + job 00:15 hằng ngày (trước 90 ngày); xóa buổi = hủy mềm (`status='cancelled'`) |
| POST                | `/trials/:id/convert`, `/leads/:id/convert`    | Chuyển thành học viên — atomic, chống convert trùng → `201`                                              |
| GET                 | `/dashboard`                                   | Số liệu tổng quan                                                                                        |
| GET                 | `/payroll?month=`                              | Bảng lương — 1 query GROUP BY; tháng đã chốt trả số chụp lúc chốt                                        |
| GET                 | `/audit-logs`                                  | Nhật ký kiểm toán (filter + pagination)                                                                  |
| GET/PUT             | `/zalo/*`                                      | Cấu hình + lịch sử nhắc Zalo                                                                             |

## Phụ huynh (parent token — CHỈ `/api/v1/parent/*`)

| Method   | Endpoint                           | Mô tả                                                  |
| -------- | ---------------------------------- | ------------------------------------------------------ |
| GET      | `/parent/children`                 | Danh sách con đã liên kết                              |
| POST     | `/parent/link`                     | Liên kết con (cần `student_code` + `dob` đúng) → `201` |
| GET      | `/parent/children/:id/overview`    | Tổng quan 1 con                                        |
| GET      | `/parent/children/:id/grades`      | Sổ liên lạc điện tử                                    |
| GET      | `/parent/invoices/:id/vietqr`      | Lấy thông tin VietQR                                   |
| POST     | `/parent/invoices/:id/vnpay`       | Tạo URL VNPay → `201`                                  |
| POST     | `/parent/invoices/:id/claim-paid`  | Báo đã chuyển khoản (chờ duyệt) → `201`                |
| GET/POST | `/parent/leaves`                   | Xin nghỉ — chặn trùng ngày → `409`                     |
| GET      | `/parent/referral`                 | Mã giới thiệu + credit                                 |
| GET/POST | `/parent/reviews`                  | Đánh giá trung tâm                                     |
| POST     | `/parent/homework/:id/complete`    | Đánh dấu hoàn thành → `201`                            |
| POST     | `/parent/homework/:id/submit`      | Nộp bài (file) → `201`                                 |
| POST     | `/parent/homework/:id/quiz/submit` | Nộp quiz → `201`                                       |

## Rate limiting

- `/auth/login`, `/parent/login`, `/parent/register`: 10 req / 60s / IP → `429`.
- Toàn `/api/v1`, theo tài khoản (IP nếu chưa đăng nhập): GET/HEAD đã đăng nhập 1500 req / 15 phút; còn lại (ghi,
  ẩn danh) 300 req / 15 phút. Cổng phụ huynh thêm trần riêng (GET 1000, còn lại 200). Ghi (POST/PUT/PATCH/DELETE) có trần riêng
  theo tài khoản; 429 kèm `retry_after` (giây) + header `Retry-After` — giá trị hiện hành xem `server/src/middleware/rateLimit.ts`. Mọi trần tính per-worker (`RATE_LIMIT_DIVISOR`).

## Idempotency (chống double-submit)

- Các POST tiền bạc hỗ trợ header `Idempotency-Key: <uuid>`: tạo hóa đơn (`POST /invoices`), thu tiền
  (`/invoices/:id/payments`) và hoàn tiền (`/invoices/:id/refund`).
- Client giữ nguyên key cho cùng một ý định thanh toán (không sinh mới khi retry).
- Server trả lại response đã lưu nếu key trùng (không tạo payment mới).
