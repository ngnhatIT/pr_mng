# Quy ước phát triển — EduCenterPro

Tài liệu này dành cho dev mới join. Đọc `docs/ARCHITECTURE.md` trước.

## Thêm 1 tính năng mới (checklist)

1. **DB**: thêm bảng/cột vào `server/src/db/schema.ts` (+ migration trong `migrations.ts` nếu DB cũ cần nâng cấp).
2. **Service**: viết hàm nghiệp vụ trong `server/src/modules/<domain>/<domain>.service.ts`.
   Service là hàm thuần nhận `(centerId | ScopeCtx, ...args)` — KHÔNG nhận `req/res`.
3. **Route**: thêm handler mỏng trong `<domain>.routes.ts`:
   ```ts
   router.post(
     '/',
     staffOnly,
     asyncHandler(async (req: AuthRequest, res: Response) => {
       const input = validate(req.body, { name: v.string({ required: true, max: 100, label: 'Tên' }) });
       res.status(201).json(myService.create(reqCenterId(req), input));
     })
   );
   ```
4. **Test**: thêm case vào `*.test.ts` cạnh file service (chạy `npm test` trong `server/`).
5. **Client**: thêm API call vào `client/src/features/<domain>/<domain>.api.ts`, dùng trong page.

## Quy tắc bắt buộc

- ❌ Không `try/catch` trong route → dùng `asyncHandler`.
- ❌ Không `res.status(4xx).json(...)` → `throw AppError.*`.
- ❌ Không `db.prepare` trong route → chuyển vào service.
- ❌ Không `process.env` trực tiếp → thêm vào `config/env.ts`.
- ❌ Không `console.log` → dùng `logger.scope('<domain>')`.
- ❌ Không query thiếu `center_id` → dùng `findByIdOr404` từ `shared/repository.ts`.
- ✅ Mọi endpoint staff mới phải qua `denyParents` (đã gắn ở mount trong `app.ts`).
- ✅ Input từ client luôn qua `validate()` trước khi vào service.

## Chạy test

```bash
cd server && npm test        # unit test (node:test, 0 dependency)
```

## Code chuẩn (lint + format + CI)

```bash
npm run lint          # ESLint kiểm tra server/src + client/src
npm run lint:fix       # Tự sửa lỗi lint được
npm run format        # Prettier format toàn bộ code
npm run format:check  # Kiểm tra format (CI chạy)
```

CI (`.github/workflows/ci.yml`) tự chạy trên mỗi push/PR:

1. Lint + format check
2. Unit tests
3. Build server + client

Quy tắc lint chính: cấm `console.log` (dùng `logger`), cấm biến không dùng,
`prefer-const`.

## Cấu trúc import

```ts
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { validate, v, paramId } from '../../shared/validate';
import { findByIdOr404 } from '../../shared/repository';
import { logger } from '../../shared/logger';
import { reqCenterId } from '../../middleware/auth';
```
