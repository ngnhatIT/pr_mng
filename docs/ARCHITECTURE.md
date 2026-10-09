# Kiến trúc EduCenterPro

Tài liệu dành cho developer tiếp quản / mở rộng dự án.

## Tổng quan

```
educenter-pro-full/
├── server/          # Backend: Express + TypeScript + PostgreSQL (pg pool)
├── client/          # Frontend: React + Vite + TypeScript
└── package.json     # Monorepo (npm workspaces)
```

## Backend (`server/src/`)

Theo **layered architecture**: `routes` (HTTP) → `services` (nghiệp vụ) → `db` (dữ liệu).

```
server/src/
├── index.ts            # Entry point DUY NHẤT: đọc env, start server + scheduler
├── app.ts              # Factory tạo Express app (để test được mà không start server)
├── config/
│   └── env.ts          # MỌI biến môi trường tập trung ở đây, validate lúc khởi động
├── db/                 # Tầng dữ liệu
│   ├── pg-compat.ts    # Pool PostgreSQL + lớp tương thích API (prepare/get/all/run/exec/transaction)
│   ├── schema.ts       # CREATE TABLE (idempotent)
│   ├── migrations.ts   # Thêm cột cho DB cũ (idempotent)
│   ├── date-utils.ts   # Hàm thuần: ngày tháng, lịch học (+ date-utils.test.ts)
│   ├── helpers.ts      # Helper nghiệp vụ dùng chung (settings, sinh buổi học...)
│   ├── seed.ts         # Dữ liệu demo lần đầu
│   └── index.ts        # Barrel: chạy schema → migrations → seed, re-export
├── modules/<domain>/   # Mỗi domain 1 thư mục
│   ├── index.ts              # Barrel export
│   ├── <domain>.routes.ts    # CHỈ HTTP: validate input → gọi service → res.json
│   └── <domain>.service.ts   # MỌI query SQL + nghiệp vụ (pure functions, dễ test)
├── services/           # Service dùng chung nhiều domain (zalo, vnpay, notify... + vnpay.test.ts)
├── jobs/               # Tác vụ nền (reminderScheduler)
├── middleware/         # auth, rateLimit
├── shared/             # Dùng chung toàn server
│   ├── errors.ts       # AppError (badRequest/forbidden/notFound/...)
│   ├── http.ts         # asyncHandler + errorHandler + notFoundHandler
│   ├── validate.ts     # Validate input (v.string/v.number/... + type inference)
│   ├── repository.ts   # findByIdOr404/belongsToCenter/deleteById (scope multi-tenant)
│   └── logger.ts       # Logger chuẩn (level/scope/timestamp, thay console.log)
└── utils/              # Hàm tiện ích lẻ (plans)
```

**Unit test:** `*.test.ts` đặt cạnh file nguồn, chạy bằng `cd server && npm test`
(dùng `node:test` có sẵn, 0 dependency). Hiện có 24 tests: validate, AppError,
asyncHandler, date-utils, chữ ký VNPay.

### Audit log

Mọi thao tác quan trọng được ghi vào bảng `audit_logs`: ai (tên + role + IP),
làm gì (create/update/delete/approve/reject/payment/apply_credit),
trên đối tượng nào, tóm tắt tiếng Việt.

Tự động ghi cho: tạo/sửa/xóa phiếu thu, thu tiền, trừ credit,
duyệt/từ chối thanh toán, xóa học viên/giáo viên/lớp học.
Xem tại `/app/nhat-ky` (chỉ admin) hoặc `GET /api/audit-logs`.

## Quy ước quan trọng

1. **Không try/catch trong route.** Bọc handler bằng `asyncHandler(...)`; lỗi ném bằng
   `throw AppError.notFound('...')`; `errorHandler` tập trung ở cuối `app.ts` lo phần còn lại.
2. **Route không chứa nghiệp vụ.** Mọi `db.prepare` nằm trong `<domain>.service.ts`;
   route chỉ `validate()` → gọi service → `res.json()`. Service nhận `ScopeCtx`
   `{ centerId, role, teacherId }` thay vì `req` để dễ unit test.
3. **Không `process.env` rải rác.** Thêm biến mới vào `config/env.ts`.
4. **Scope multi-tenant:** dùng `findByIdOr404(table, id, centerId, message)` từ
   `shared/repository.ts` thay vì viết tay 5 dòng check.
5. **Phân quyền:** `requireAuth` → `denyParents` (ở mount trong `app.ts`) → `staffOnly` /
   `teacherOnly` / `adminOnly` / `superadminOnly` (trong route). Phụ huynh CHỈ dùng `/api/parent`.
6. **Multi-tenant:** mọi query nghiệp vụ lọc theo `centerId`; superadmin (`centerId=null`) bypass.

### Thêm 1 domain mới

```
mkdir server/src/modules/<ten>
# <ten>.routes.ts: import { asyncHandler } from '../../shared/http'
#                 import { db } from '../../db'
#                 import { ... } from '../../middleware/auth'
```
Rồi mount trong `app.ts`: `app.use('/api/<ten>', ...staff, <ten>Routes);`

## Frontend (`client/src/`)

Theo **feature-based architecture**: code gom theo tính năng, không theo loại file.

```
client/src/
├── main.tsx            # Entry: render <App/> + ToastProvider + styles
├── app/
│   └── App.tsx         # Router + redirect cũ
├── features/<domain>/  # Mỗi tính năng 1 thư mục
│   ├── landing/  auth/  dashboard/
│   ├── students/  classes/  tuition/  people/  leaves/
│   ├── admissions/  homework/  growth/  notifications/  system/
│   ├── parent/     # Portal phụ huynh (layout + bottom tabs)
│   ├── teacher/    # Portal giáo viên
│   └── <domain>.api.ts  # API LAYER: types + hàm gọi API — page CHỈ import từ đây,
│                        # không gọi http trực tiếp với URL string rải rác
├── shared/             # Dùng chung
│   ├── api/client.ts   # http client + getToken/getUser
│   ├── components/     # UI kit: PageHeader, EmptyState, Skeleton, StatCard, Modal...
│   ├── ui/toast.tsx    # ToastProvider + useToast
│   └── types.ts        # Kiểu dữ liệu dùng chung
└── styles/
    └── styles.css      # Design system (tokens, components, responsive)
```

### Quy ước

1. Page trong `features/<domain>/` là PascalCase (`Students.tsx`).
2. Mọi gọi API qua `http` từ `shared/api/client` — không fetch trực tiếp.
3. Component dùng lại ≥2 nơi → chuyển vào `shared/components/`.
4. Mỗi trang: `PageHeader` + `Skeleton` lúc tải + `EmptyState` khi trống.

## Kiểm thử

- **UT:** logic thuần ở `server/src/shared`, `server/src/config`, `server/src/services`
- **IT:** script gọi API thật theo luồng (`/tmp/it/run_it.js` mẫu)
- **Build:** `npm run build` (tsc server + tsc client + vite) phải xanh trước khi đóng gói
