# EduCenter Pro — Full

Phần mềm quản lý trung tâm ngoại ngữ / lớp học / gym — bản full 3 giai đoạn: cổng phụ huynh, tuyển sinh, SaaS đa trung tâm.

## Cấu trúc truy cập

| Đường dẫn | Đối tượng |
|---|---|
| `/` | Landing page công khai của trung tâm (giới thiệu, đăng ký tư vấn/học thử) |
| `/login` | Đăng nhập quản trị / giáo viên |
| `/app/*` | App quản trị trung tâm (admin, nhân viên) |
| `/parent/*` | Cổng phụ huynh (đăng nhập bằng SĐT) |
| `/teacher/*` | Portal giáo viên |

## Tài khoản demo (mật khẩu `123456`)

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin` | `123456` | Quản trị trung tâm demo |
| `teacher1` | `123456` | Giáo viên (dạy lớp demo) |
| `root` | `123456` | Superadmin — quản trị hệ thống đa trung tâm |
| SĐT `0900000001` | `123456` | Phụ huynh demo (đã liên kết HV001, HV002) — đăng nhập tại `/parent/login` |

Dữ liệu lưu trong PostgreSQL (tự tạo schema + seed khi chạy lần đầu).

## Database: PostgreSQL

```bash
# 1. Cài PostgreSQL 16+ và tạo database
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER educenter WITH PASSWORD 'educenter123' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE educenter OWNER educenter;"

# 2. Cấu hình (copy .env.example thành server/.env)
DATABASE_URL=postgres://educenter:educenter123@localhost:5432/educenter

# 3. Chạy — schema 44 bảng + 36 trigger tự tạo lần đầu
npm run dev
```

Đang dùng SQLite cũ? Migrate dữ liệu:

```bash
npx tsx scripts/migrate-sqlite-to-pg.ts --sqlite ./server/data.db --pg $DATABASE_URL
```

Script chỉ đọc SQLite (read-only), ghi PG trong 1 transaction, giữ nguyên id,
reset sequence và đối chiếu số dòng từng bảng.

## Giai đoạn 1 — Cổng phụ huynh & vận hành

- **Tài khoản phụ huynh:** đăng ký/đăng nhập bằng SĐT tại `/parent`; liên kết con qua mã học viên; xem tổng quan từng con (lịch học sắp tới, thống kê điểm danh, học phí, điểm số, bài tập, credits).
- **Thanh toán học phí online:** phụ huynh quét **VietQR** (không cần key, dùng ảnh `img.vietqr.io`), thanh toán **VNPay** (sandbox), hoặc báo "Đã chuyển khoản" để admin duyệt trong tab **Chờ duyệt** của trang Học phí.
- **Thông báo tự động:** học viên vắng mặt → ghi nhắc `absence`; duyệt/từ chối đơn nghỉ → `leave_result`; duyệt thanh toán → `payment_confirmed` (xem trong Lịch sử nhắc).
- **Xin nghỉ phép online:** phụ huynh tạo đơn → admin duyệt/từ chối kèm gợi ý buổi học bù.
- **Sổ liên lạc điện tử:** nhập điểm theo học viên/lớp, phụ huynh xem biểu đồ tiến bộ (SVG).
- **Đăng ký học thử:** form public → trang Học thử (duyệt / chuyển thành học viên).
- **Bài tập về nhà:** giáo viên/admin giao theo lớp; phụ huynh xem theo từng con.
- **Tài khoản giáo viên + chấm công:** tạo tài khoản cho giáo viên (trang Giáo viên → "Tạo tài khoản"); admin tạo mã điểm danh 6 số trong buổi học; giáo viên nhập mã tại `/teacher` để chấm công.
- **Phòng học:** CRUD phòng; tạo/sửa lớp kiểm tra **trùng lịch phòng** (cùng thứ + giờ giao nhau → báo lỗi).
- **Lương giáo viên:** nhập đơn giá/buổi theo giáo viên; bảng lương tháng = số buổi đã dạy (có điểm danh hoặc chấm công) × đơn giá; giáo viên xem lương của mình.

## Giai đoạn 2 — Tuyển sinh & tăng trưởng

- **Landing page** tại `/`: hero, khóa học, giáo viên, đánh giá sao, form đăng ký tư vấn (→ Lead) và đăng ký học thử (→ Trial, hỗ trợ `?ref=MÃ_GIỚI_THIỆU`).
- **Quản lý Lead (mini-CRM):** pipeline Mới → Đã liên hệ → Học thử → Đăng ký → Mất; chuyển lead thành học viên.
- **Giới thiệu bạn bè:** mỗi phụ huynh có mã giới thiệu (`/parent/referral`); người được giới thiệu thanh toán đủ hóa đơn đầu tiên → cả hai cùng nhận **credits** (mặc định 200.000đ mỗi bên, chỉnh trong Cấu hình thanh toán); credits trừ thẳng vào hóa đơn (trang Học phí → "Áp dụng credits").
- **Đánh giá:** phụ huynh gửi sao + nhận xét; admin duyệt; hiển thị công khai trên landing.

## Giai đoạn 3 — SaaS đa trung tâm

- Mỗi trung tâm có `subdomain` riêng; dữ liệu (học viên, lớp, giáo viên, phụ huynh, lead...) tách theo `center_id`. Tài khoản `root` (superadmin) quản lý tại `/app/system`: tạo trung tâm mới (+ tài khoản admin), đổi gói/hạn.
- **Gói cước:** Cơ bản 199k (không nhắc Zalo tự động, không landing) · Tiêu chuẩn 399k (+Zalo, +landing) · Cao cấp 799k (full). Scheduler nhắc Zalo bỏ qua trung tâm hết hạn/không có quyền.
- **PWA:** `manifest.json` + service worker cache app-shell — cài như app trên điện thoại (production).

## Hướng dẫn cấu hình thanh toán

Vào `/app/cau-hinh-thanh-toan` (quyền admin), theo từng trung tâm:

1. **VietQR (không cần đăng ký):** nhập *mã ngân hàng* (vietcombank, mb, techcombank...), *số tài khoản*, *tên tài khoản*. Phụ huynh sẽ thấy nút "Quét VietQR" kèm mã QR đúng số tiền + nội dung `HD<mã hóa đơn>`.
2. **VNPay:** đăng ký merchant tại VNPay để có `TMN Code` và `Hash Secret`; nhập vào form và bật công tắc. Hệ thống đang dùng **môi trường SANDBOX** (`sandbox.vnpayment.vn`) để demo — khi chạy thật, đổi `VNPAY_PAY_URL` trong `server/src/services/vnpay.ts` sang `https://www.vnpayment.vn/paymentv2/vpcpay.html`.
3. **Thưởng giới thiệu:** nhập số tiền credits cho người giới thiệu / người được giới thiệu (mặc định 200.000đ).

Luồng "Đã chuyển khoản": phụ huynh bấm báo đã chuyển → khoản thu ở trạng thái `pending` (không tính vào công nợ) → admin vào tab **Chờ duyệt** để Duyệt/Từ chối.

## Yêu cầu & cách chạy

- Node.js 18+

```bash
# Cài đặt (chạy 1 lần ở thư mục gốc)
npm install

# Chạy dev: server (4000) + client (5173)
npm run dev
```

Mở **http://localhost:5173** (landing). Tài khoản demo xem bảng trên.

## Build production

```bash
npm run build
npm start   # phục vụ cả client đã build tại http://localhost:4000
```

### Cấu hình production

Đặt các biến môi trường sau trước khi chạy production:

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `JWT_SECRET` | **Có** | Chuỗi bí mật để ký JWT (tối thiểu 32 ký tự ngẫu nhiên). Nếu không đặt, server dùng secret mặc định và in cảnh báo — **không an toàn cho production**. |
| `PORT` | Không | Cổng chạy server (mặc định `4000`). |

Ví dụ:

```bash
JWT_SECRET="$(openssl rand -hex 32)" PORT=4000 npm start
```

Lưu ý: đổi `JWT_SECRET` sẽ làm mọi token đang đăng nhập hết hiệu lực (người dùng phải đăng nhập lại).

## API chính (mới trong bản full)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| POST | /api/parent/register · /api/parent/login | public | Đăng ký/đăng nhập phụ huynh (SĐT) |
| POST | /api/parent/link | parent | Liên kết con theo mã học viên |
| GET | /api/parent/children/:id/overview | parent | Tổng quan 1 con |
| GET | /api/parent/invoices/:id/vietqr | parent | Link QR VietQR |
| POST | /api/parent/invoices/:id/claim-paid | parent | Báo đã chuyển khoản (pending) |
| POST | /api/parent/invoices/:id/vnpay | parent | Tạo URL thanh toán VNPay |
| GET | /api/payments/vnpay-return | public | VNPay callback (verify HMAC SHA512) |
| GET | /api/payments/pending | staff | Khoản chờ duyệt |
| POST | /api/payments/pending/:id/approve\|reject | staff | Duyệt/từ chối |
| GET/PUT | /api/payments/config | admin | Cấu hình thanh toán theo trung tâm |
| POST | /api/invoices/:id/apply-credit | staff | Áp credits trừ học phí |
| GET/POST | /api/leaves · POST /api/leaves/:id/approve\|reject | staff | Duyệt nghỉ phép (+ gợi ý học bù) |
| GET/POST/DELETE | /api/grades | staff | Sổ liên lạc điện tử |
| CRUD | /api/homework · /api/rooms | staff | Bài tập · Phòng học |
| GET/PUT | /api/payroll · /api/payroll/rules | staff/admin | Bảng lương · đơn giá |
| GET/POST | /api/trials · POST /api/trials/:id/convert | staff | Đăng ký học thử |
| GET | /api/teacher/today · POST /api/teacher/checkin | teacher | Buổi dạy · chấm công bằng mã |
| POST | /api/sessions/:id/checkin-code | staff | Tạo mã điểm danh 6 số |
| GET | /api/public/center·classes·teachers·reviews | public | Dữ liệu landing |
| POST | /api/public/leads · /api/public/trials | public | Form landing (rate-limit) |
| CRUD | /api/leads · POST /api/leads/:id/convert | staff | Mini-CRM |
| GET | /api/referrals · /api/referrals/stats | staff | Giới thiệu bạn bè |
| GET/POST | /api/reviews · POST /api/reviews/:id/approve\|reject | staff | Duyệt đánh giá |
| GET/POST/PUT | /api/centers | superadmin | Quản trị đa trung tâm |

API cũ (`/api/students`, `/api/classes`, `/api/sessions`, `/api/invoices`, `/api/dashboard`, `/api/teachers`, `/api/zalo`, `/api/reminders`) giữ nguyên và đã được lọc theo trung tâm.

## Ghi chú kỹ thuật

- Lịch học lưu JSON `[{day: 2-8, start: "18:00", end: "20:00"}]` (2 = Thứ Hai … 8 = Chủ Nhật).
- Trạng thái hóa đơn chỉ tính các khoản `payments.status='confirmed'`; khoản `pending` (chờ duyệt) không trừ công nợ.
- Cấu hình Zalo/thanh toán lưu theo trung tâm (`center_settings`), có fallback về `settings` toàn cục cho DB cũ.
- Public API xác định trung tâm qua subdomain của Host, ngược lại dùng trung tâm đầu tiên.
- Zalo ZNS: xem hướng dẫn cấu hình trong bản MVP (mục "Nhắc học phí qua Zalo" ở README cũ). Các loại nhắc mới (vắng mặt, duyệt nghỉ, xác nhận thanh toán) hiện ghi log ở chế độ demo trong Lịch sử nhắc — cần thêm Template ID riêng nếu muốn gửi ZNS thật.
