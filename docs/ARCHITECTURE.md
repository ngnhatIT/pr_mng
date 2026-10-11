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
│   ├── schema.ts       # Quy ước schema + SCHEMA_VERSION + re-export các file schema.*.ts
│   ├── schema.tables.ts    # createSchema: CREATE TABLE/INDEX (idempotent)
│   ├── schema.docs.ts      # TABLE_DOCS — data dictionary (schema.test.ts kiểm)
│   ├── schema.triggers.ts  # trigger maintain, bảng lịch sử tiền, view
│   ├── schema.validate.ts  # validateSchema
│   ├── migrations.ts   # Migration có version (schema_migrations, advisory lock) + bootDdlDb (DDL boot có lock_timeout)
│   ├── indexes.ts      # Index hot path (idempotent)
│   ├── date-utils.ts   # Hàm thuần: ngày tháng, lịch học (+ date-utils.test.ts)
│   ├── helpers.ts      # Helper nghiệp vụ dùng chung (settings, sinh buổi học...)
│   ├── seed.ts         # Dữ liệu demo lần đầu
│   └── index.ts        # initDatabase (dưới advisory lock toàn cục) + re-export
├── modules/<domain>/   # Mỗi domain 1 thư mục
│   ├── index.ts              # (chỉ auth, zalo có barrel — module khác import trực tiếp file)
│   ├── <domain>.routes.ts    # CHỈ HTTP: validate input → gọi service → res.json
│   └── <domain>.service.ts   # MỌI query SQL + nghiệp vụ (pure functions, dễ test)
├── services/           # Service dùng chung nhiều domain (zalo, vnpay, notify... + vnpay.test.ts)
├── jobs/               # Tác vụ nền: nhắc Zalo, backup, consistency, đối soát VNPay, sinh buổi học, dọn upload
├── middleware/         # auth, requireFeature (gói cước), rateLimit, idempotency
├── shared/             # Dùng chung toàn server
│   ├── errors.ts       # AppError (badRequest/forbidden/notFound/...)
│   ├── http.ts         # asyncHandler + errorHandler + notFoundHandler
│   ├── validate.ts     # Validate input (v.string/v.number/... + type inference)
│   ├── repository.ts   # findByIdOr404/belongsToCenter/deleteById (scope multi-tenant)
│   └── logger.ts       # Logger chuẩn (level/scope/timestamp, thay console.log)
└── utils/              # Hàm tiện ích lẻ (plans)
```

**Unit test:** `*.test.ts` đặt cạnh file nguồn, chạy bằng `cd server && npm test`
(dùng `node:test` có sẵn, 0 dependency; chạy tuần tự `--test-concurrency=1` vì mọi file dùng chung
DB test). Vài trăm test server (unit + integration trên PostgreSQL thật: validate, AppError, VNPay,
RBAC, refund, trial/lead convert race, idempotency, consistency...) + test client (vitest).
DB test phải có tên kết thúc `_test` — `setupTestDb()` từ chối DROP trên DB khác.

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
5. **Phân quyền (RBAC):** `requireAuth` → `denyParents` (ở mount trong `app.ts`) →
   `requirePermission('<module>.<action>')` với scope `own`/`center`/`all` (scope mạnh nhất thắng,
   cache 60s). 61 permissions trong catalog (`modules/authorization/permissions.ts`).
   Roles hệ thống: superadmin (61/all), admin (61/center), staff (37), teacher (12/own).
   Custom role tạo qua API `/roles`. Phụ huynh CHỈ dùng `/api/parent` (token có `kind: 'parent'`).
6. **Multi-tenant:** mọi query nghiệp vụ lọc theo `centerId`; superadmin (`centerId=null`) bypass.

### Thêm 1 domain mới

```
mkdir server/src/modules/<ten>
# <ten>.routes.ts: handler mỏng — import { asyncHandler } from '../../shared/http'
#                 import { requirePermission, reqCenterId } from '../../middleware/auth'
#                 gọi hàm trong <ten>.service.ts (SQL nằm ở service/repo, KHÔNG import db trong route)
```

Rồi mount trong `app.ts` trên router versioned: `v1.use('/<ten>', ...staff, <ten>Routes);`
(`staff = [requireAuth, denyParents]`). `/api/*` chỉ là alias legacy (có header `Deprecation`), không mount riêng.

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
5. Modal/form dirty, tải dữ liệu (`useLoad`), trạng thái trên URL (`useUrlState`/`useUrlSearch`), toast lỗi, ô tiền, i18n lazy, ngân sách bundle: xem **[FRONTEND.md](FRONTEND.md)**.

## Kiểm thử

- **UT:** logic thuần ở `server/src/shared`, `server/src/config`, `server/src/services`
- **Test:** `*.test.ts` cạnh code (node:test) chạy trên PostgreSQL thật — `cd server && npm test` (serial, DB `*_test` qua `TEST_DATABASE_URL`; xem `docs/CONTRIBUTING.md`)
- **Build:** `npm run build` (tsc server + tsc client + vite) phải xanh trước khi đóng gói
