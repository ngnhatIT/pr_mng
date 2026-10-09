# Changelog — EduCenterPro

## 2026-10-09 — Vòng "chuẩn quốc tế" (audit → fix liên tục)

- **Performance**: migration v7 thêm 18 index cho FK nóng; `getCenterSettings` batch 1 query;
  dashboard 7 query chạy song song; bảng lương viết lại 1 query `GROUP BY`.
- **Service-layer**: chuyển transaction khỏi routes (centers, roles, leads); `convertLeadToStudent` atomic.
- **API consistency**: Swagger bổ sung roles/parent refresh-logout/VNPay/metrics, sửa 17 path homework
  + path enrollments; roles envelope về raw array; `201` cho mọi endpoint tạo resource.
- **Accessibility (WCAG AA)**: fix contrast `--text-faint`/placeholder, `prefers-reduced-motion`,
  `aria-label` cho search inputs, `<html lang>` động, Escape đóng drawer mobile.
- **Docs**: viết lại `API.md` (auth flow, RBAC, endpoint refund), `DEPLOYMENT.md` (env đầy đủ),
  thêm `server/.env.example`, `CHANGELOG.md`.

## 2026-10-09 — Audit nghiệp vụ

- **Hoàn tiền**: `POST /invoices/:id/refund` (quyền `payments.refund`) — payment âm `method='refund'`,
  tự trừ công nợ, chặn hoàn vượt số đã thu, chống race bằng `FOR UPDATE`, UI + RefundModal.
- **Trial convert**: atomic bằng `UPDATE` có điều kiện (chống tạo trùng học viên).
- **Đơn nghỉ**: chặn khoảng ngày giao nhau (409).

## 2026-10-09 — Refresh token rotation

- Access token 1h; refresh token opaque 48-byte, 30 ngày, lưu DB dạng SHA-256 hash.
- Rotation + reuse detection (dùng lại token cũ → thu hồi cả chuỗi).
- `POST /auth/refresh`, `/auth/logout`, `/parent/refresh`, `/parent/logout`; client tự refresh khi 401.

## 2026-10-09 — Dynamic pentest

- Fix 3 bug thật: `db.all(array)`/`get(array)` trong `loginParent`/`linkStudent`/`createReview`;
  thêm `normParams()`; viết lại script `npm test` bị cắt cụt.
- JWT tampering, parent IDOR, cross-center, SQLi, brute force, VNPay replay đều bị chặn.

## 2026-10-09 — RBAC

- 61 permissions, roles hệ thống + custom, scope own/center/all; middleware `requirePermission`.
- Trang `/app/phan-quyen`: ma trận phân quyền theo module.

## 2026-10-09 — PostgreSQL migration

- Chuyển từ better-sqlite3 sang PostgreSQL 16 (`pg-compat.ts`); 44 bảng, 36 trigger, 73 index.

## 2026-10-08 — MVP + các vòng hoàn thiện

- MVP quản lý trung tâm/lớp/học viên/học phí; parent portal; teacher portal; multi-tenant;
  Zalo ZNS; VNPay; landing page; lead CRM; referral; PWA; i18n vi/en; dark mode.
