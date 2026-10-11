# Code review toàn bộ EduCenter Pro — 2026-10-10

Commit `6e09f1e` (main). Phạm vi: toàn bộ `server/src`, `client/src`, CI, docs, ops.

Cách làm: 9 reviewer, mỗi người một vùng code (đọc tổng cộng khoảng 470 file). Mỗi phát hiện critical, high hoặc medium được một verifier phản biện riêng. Sau đó 2 giám khảo chấm điểm độc lập. Cuối cùng, các lỗi nặng nhất được kiểm tra lại thủ công.

## Điểm: **42 / 100**

| Hạng mục | Điểm | Max | Nhận xét ngắn |
|---|---:|---:|---|
| Bảo mật | 8 | 20 | Auth được làm kỹ (refresh rotation, token_version, HttpOnly cookie, HS256 pin). Nhưng có 1 lỗi critical leo quyền xuyên tenant và nhiều lỗ hổng cô lập tenant |
| Tính đúng đắn | 6 | 20 | Nhiều luồng lõi hỏng khi chạy thật: chấm tự luận, idempotency, nhắc Zalo, điểm danh của GV, hóa đơn hiện Đã thu=0, reload bị đăng xuất |
| Kiến trúc & bảo trì | 7.5 | 15 | Tổ chức module theo domain tốt, có AppError/validate dùng chung, migration có version. Nhưng SQL nằm cả trong route, logic rải ở 3 nơi, nhiều file quá lớn |
| Kiểm thử & CI | 5 | 15 | 369 test, nhiều test race/IDOR trên PG thật. Nhưng suite race khi chạy song song, 29 test fail kể cả khi chạy tuần tự, CI đỏ |
| Frontend | 5 | 10 | a11y và i18n tốt (focus trap, parity test). Lỗi UX nặng: reload là logout, SW cache-first không có version, biên lai NaN |
| Hiệu năng | 6 | 10 | Có phân trang, index ở các query nóng, đã gỡ N+1. Nhưng mỗi query chạy BEGIN/set_config/COMMIT, GET /sessions sinh INSERT |
| Vận hành & tài liệu | 4 | 10 | Backup, advisory lock và log có cấu trúc đều tốt. Nhưng CI đỏ vì 3 lý do, smoke test không thể pass, HEAD không đọc được server/.env |
| **Tổng** | **42** | **100** | Hai giám khảo độc lập: 38 (lens production) và 43 (lens engineering) |

Thang tham chiếu: 75 trở lên là production-ready, 60–74 là chạy được nhưng có lỗ hổng đáng kể, 40–59 là còn vấn đề lớn.

## Số liệu khách quan

| Kiểm tra | Kết quả |
|---|---|
| tsc server/client | ✅ 0 lỗi |
| eslint | ✅ 0 lỗi |
| prettier --check | ❌ 63 file chưa format, CI job lint đỏ |
| client vitest | ✅ 52/52 |
| server test (mặc định, song song) | ❌ 157 pass, 2 fail, **210 cancelled**: các file test cùng drop/create schema trên 1 DB nên race nhau |
| server test (tuần tự, HEAD sạch) | ⚠️ 340/369 pass, **29 fail**. Trong đó 5 fail do bug thật `ps.id` (zalo.ts:394), 7 do fixture `is_system` 0/1 thay vì boolean, 6 do pool bị end trước teardown, còn lại do assert lệch message hoặc data dictionary |
| npm audit (prod) | ⚠️ 5 moderate: react-router open-redirect, yamljs→argparse→sprintf-js |
| Phát hiện sau phản biện | 2 critical · 36 high · 81 medium · 86 low (bác bỏ 1) |

## Ưu tiên sửa (theo thứ tự)

1. **[Critical] Leo quyền xuyên tenant**: `authorization.service.ts:197` cho phép admin trung tâm tạo role với scope `all`, tự gán role đó, rồi reset mật khẩu admin trung tâm khác (`auth.routes.ts:271`). Cách sửa: chặn scope `all` và `system.*` với người không phải superadmin, giới hạn scope không vượt quá quyền của chính người gọi, và ghi audit.
1. **Rò rỉ dữ liệu giữa tenant**: bảng `reset_requests` không có `center_id` nên mọi admin thấy username và SĐT của tất cả trung tâm. Referral khớp theo SĐT cũng không lọc tenant (`services/referrals.ts:100`). Mã HV + ngày sinh có thể brute-force để liên kết con (`parent.service.ts:196`).
1. **pg-compat tự thêm `RETURNING id`** vào INSERT cho cả `idempotency_keys` và `quiz_essay_scores` (`pg-compat.ts:204`). Kết quả là idempotency key không bao giờ được lưu, và chấm tự luận rubric (commit mới nhất) luôn lỗi 500. Chỉ cần thêm 2 bảng này vào `NO_ID_TABLES`. Ngoài ra middleware idempotency kiểm tra rồi mới ghi (không atomic) và không gắn key với user/path.
1. **Nhắc học phí Zalo hỏng hoàn toàn**: `zalo.ts:394` có `ORDER BY ps.id` trong khi `parent_students` không có cột `id`. Test đã bắt được lỗi này nhưng không ai thấy vì CI đỏ sẵn. PUT `/zalo/config` còn ghi đè secret thật bằng chuỗi đã che `***`.
1. **Luồng UI lõi hỏng**: reload hoặc mở tab mới là bị đăng xuất, vì `RoleGuard` (`App.tsx:82`) đọc token trong memory mà không refresh khi khởi động. Giáo viên không lưu được điểm danh vì `Attendance.tsx:140` gọi PUT `/sessions/:id` (cần `sessions.manage`) trước khi lưu. Chi tiết hóa đơn luôn hiện Đã thu = 0 (`getInvoiceDetail` không tính `paid`). Biên lai in ra `NaNđ`. File đính kèm của GV không tải được (`uploadAccess.ts:27` chỉ tra `homework_submissions`).
1. **Homework**: sửa bài nháp/hẹn giờ thì bài bị publish luôn. Giao một bài cho nhiều lớp dùng chung 1 file vật lý, nên xóa ở một bài là mất file ở tất cả. Điểm rubric cộng thô, không quy đổi theo thang điểm của câu.
1. **Thanh toán**: chữ ký VNPay 2.1.0 tính trên giá trị chưa encode. Nếu khách trả dư hoặc hóa đơn đã bị xóa thì giao dịch VNPay thành công bị bỏ qua, không ghi nhận, không cảnh báo. Hoàn tiền làm khoản đã hoàn quay lại thành nợ và kích hoạt nhắc nợ. Cần test lại với sandbox VNPay trước khi nhận tiền thật.
1. **Mạng lưới an toàn**: chạy test với `--test-concurrency=1` (hoặc mỗi file dùng một schema riêng), sửa 29 test fail, chạy prettier, sửa smoke test CI (thiếu `DATABASE_URL`, sai port). Glob test hiện bỏ sót `middleware/` và `jobs/`.

## Điểm mạnh

- Auth: refresh token rotation có phát hiện token bị đánh cắp, thu hồi qua `token_version`, cookie HttpOnly giới hạn path và có kiểm tra Origin, pin HS256, login timing-safe.
- Toàn bộ SQL đều parameterized. Upload kiểm tra magic bytes, phần mở rộng và giới hạn kích thước.
- Các luồng tiền dùng `SELECT … FOR UPDATE` và transaction. Có trigger lưu lịch sử tiền. Có test race (convert trial/lead, approve payment, VNPay IPN replay) chạy trên PG thật.
- Ops: backup bằng pg_dump có verify và rotate, cron chạy dưới advisory lock, graceful shutdown, log có cấu trúc kèm request-id, tách liveness và readiness, config fail-fast.
- Frontend: Modal có focus trap, có skip link, tôn trọng reduced-motion. Có test bảo đảm i18n vi/en đủ key. Markdown render an toàn với XSS. Code-splitting theo route.

## Phụ lục: toàn bộ phát hiện

Chi tiết từng phát hiện được giữ nguyên văn tiếng Anh như reviewer đã viết. Cột trạng thái: `confirmed` là verifier đã lần theo code và xác nhận, `plausible` là nhiều khả năng đúng, `unverified-low` là lỗi nhỏ không qua phản biện. Dấu ✔︎ nghĩa là đã được kiểm tra lại thủ công.


### CRITICAL (2)

#### `cross-cutting/SEC-1` ✔︎ — Center admin can self-grant scope 'all' and take over other tenants' accounts via password-reset flow
`server/src/modules/authorization/authorization.service.ts:197` · security · confirmed

setRolePermissions accepts any scope in ['own','center','all'] from the request body with no cap at the caller's own scope. A center admin (roles.manage, scope center) can create a custom role in their center (POST /roles), set users.update with scope 'all' (PUT /roles/:id/permissions), and assign it to themselves (POST /roles/assign checks only that role and user are in the same center). getUserPermissions then returns 'all' because the strongest scope wins. POST /auth/reset-requests/:id/process (auth.routes.ts:271-275) lets non-superadmins reset a user in another center when getPermissionScope(admin,'users.update') === 'all', and it returns the new temporary password in the response.

- **Kịch bản lỗi:** Admin of center A: 1) POST /api/v1/roles {code:'x'}; 2) PUT /roles/<id>/permissions {permissions:[{code:'users.update',scope:'all'}]}; 3) POST /roles/assign {user_id:<self>, role_id:<id>}; 4) POST /auth/forgot-password {kind:'staff', username:'<centerB admin>'} (public); 5) GET /auth/reset-requests to get the id; 6) POST /auth/reset-requests/<id>/process returns tempPassword for center B's admin. The result is a full takeover of another tenant's admin account, and the same works for parents of other centers.
- **Đề xuất:** In setRolePermissions (and the route), reject any scope higher than the caller's own scope for that permission. Non-superadmins may never grant 'all'. Better still, stop treating 'all' as cross-tenant for non-superadmin users: base the reset check on role === 'superadmin'. Add a regression test for this chain.

#### `server-core/SEC-1` ✔︎ — Center admin can grant itself scope 'all' through a custom role, then reset passwords in other centers (full cross-tenant account takeover)
`server/src/modules/authorization/authorization.service.ts:197` · security · confirmed

setRolePermissions accepts any permission code with scope 'own'|'center'|'all'. PUT /roles/:id/permissions (roles.routes.ts:162-177) only checks that the role belongs to the caller's center. It does not cap the scope at what the caller holds, and it does not stop codes such as users.update or system.manage. POST /roles/assign (roles.routes.ts:181-221) lets an admin assign that role to any user in their center, including themselves. getUserPermissions merges roles and keeps the strongest scope. The one place that grants cross-center power through scope is auth.routes.ts:271-275: `if (scope !== 'all') throw forbidden`. A self-granted users.update:'all' therefore gets past the tenant check on password reset. None of these RBAC changes are audited (only role delete is).

- **Kịch bản lỗi:** 1) Admin of center A: POST /api/v1/roles {code:'x',name:'x'}. 2) PUT /api/v1/roles/<id>/permissions {permissions:[{code:'users.update',scope:'all'}]}. 3) POST /api/v1/roles/assign {user_id:<self>, role_id:<id>}. 4) Unauthenticated POST /api/v1/auth/forgot-password {kind:'staff', username:'<center B admin>'} (B's usernames are visible via SEC-2). 5) POST /api/v1/auth/reset-requests/<id>/process returns tempPassword for center B's admin. 6) Log in as B's admin and get full access to tenant B. The same works for any parent of any center (kind:'parent').
- **Đề xuất:** In setRolePermissions, reject scope 'all' unless the caller is superadmin. Clamp every item to at most the caller's own scope for that permission, and block system.* codes for non-superadmins. Pass the caller into the service so this is enforced server-side. Audit permission changes and role assignments. Add a regression test for this chain.


### HIGH (36)

#### `client-admin/ADM-1` ✔︎ — Teachers can never save attendance: save() calls a sessions.manage-only endpoint first
`client/src/features/classes/Attendance.tsx:140` · correctness · confirmed

save() always calls `sessionsApi.updateTopic` (PUT /sessions/:id, which requires `sessions.manage`) before `saveAttendance`. The seeded `teacher` role (server/src/modules/authorization/permissions.ts ~360) only has `attendance.take`/`sessions.view`. The component also renders at /teacher/diem-danh (App.tsx:151), and it already knows the teacher lacks `sessions.manage` (canManageSessions).

- **Kịch bản lỗi:** A teacher opens /teacher/diem-danh, picks a session, marks everyone and clicks Save. PUT /sessions/:id returns 403 FORBIDDEN, the catch shows 'Không có quyền thực hiện' in the savebar, and POST /sessions/:id/attendance never runs. None of the attendance a teacher takes is ever saved.
- **Đề xuất:** Call updateTopic only when `canManageSessions` is true and the topic actually changed, or let attendance.take holders save the topic through the attendance POST. Save the attendance first so a topic error can't block it.

#### `client-admin/ADM-2` — Saving Zalo config overwrites refresh token and app secret with masked strings
`client/src/features/notifications/ZaloReminders.tsx:107` · correctness · confirmed

GET /zalo/config returns `zalo_refresh_token` and `zalo_app_secret` masked as 'abcd••••••••wxyz' (zalo.routes.ts:38-39). `setConfig({...EMPTY_CONFIG, ...data})` keeps these extra keys at runtime. save() then sends `{...config}` and strips only a masked `zalo_access_token`. The server PUT (server/src/modules/zalo/zalo.routes.ts:57-80) writes every ZALO_CONFIG_KEYS value as-is. It has no '•' skip, unlike payments.service.ts:508.

- **Kịch bản lỗi:** A center has auto-refresh configured, or the scheduler has rotated `zalo_refresh_token`. The admin edits a template and clicks 'Lưu cấu hình' or 'Lưu lịch'. The real refresh token and app secret are replaced with 'abcd••••••••wxyz'. When the access token expires (~25h), ensureZaloTokenFresh fails and tuition reminders stop. The UI has no field to re-enter these secrets.
- **Đề xuất:** Server: skip any value containing '•' for all secret keys, the same way savePaymentConfig does. Client: send only the keys this form edits (whitelist), never the whole spread response.

#### `client-admin/ADM-3` ✔︎ — Invoice detail always shows Paid = 0 and Remaining = full amount
`client/src/features/tuition/InvoiceDetail.tsx:135` · correctness · confirmed

getInvoiceDetail selects `i.*, student_name, student_code, class_name` without a `paid` aggregate (server/src/modules/invoices/invoices.service.ts:179), and the invoices table has no paid column. The client does `invoice.paid || 0`, so paid is always 0 and remain = amount. The page has the confirmed payments list but never sums it.

- **Kịch bản lỗi:** An invoice of 2,000,000đ is fully paid (status 'paid'). /app/tuition/invoices/42 shows the badge 'Đã thanh toán' next to 'Đã thu 0đ / Còn nợ 2.000.000đ', and the 'Thu tiền' button still appears because remain > 0. Printing the receipt from this page shows 'NaNđ' (see ADM-4).
- **Đề xuất:** Return `COALESCE(SUM(confirmed payments),0) AS paid` from getInvoiceDetail, using the same confirmedPaidJoin as listInvoices. As a fallback, compute paid on the client from `payments.filter(p => p.status === 'confirmed')`. Add a test for the detail shape.

#### `client-admin/ADM-4` — Printed receipt shows 'NaNđ' remaining, a literal '{date}' and a generic center name
`client/src/shared/components/ReceiptModal.tsx:58` · correctness · confirmed

The remaining amount is `invoice.amount - invoice.discount - invoice.paid`. The server has no discount column, so `discount` is always undefined and the result is NaN; `formatVND(NaN)` renders 'NaNđ'. From InvoiceDetail, `paid` is also undefined. The `receipt.date` locale string is 'Ngày {date}' (tuition.json:244) with single braces, which i18next (default `{{}}`) does not interpolate. Tuition.tsx:457 and InvoiceDetail.tsx:271 pass `centerName = t('receipt.defaultCenter')`, which is just 'Trung tâm', instead of the tenant's name.

- **Kịch bản lỗi:** The cashier clicks 'In biên lai' for any invoice in the Tuition list. The A4 receipt reads 'Còn lại: NaNđ', 'Ngày {date}' and the header 'Trung tâm'. This affects every printed receipt for every tenant.
- **Đề xuất:** Use the shared `remainingOf()` helper and remove the phantom `discount` field from InvoiceItem (or implement discount server-side). Change the locale to 'Ngày {{date}}'. Pass the real center name (from the session or center settings). Add a render test for ReceiptModal.

#### `client-admin/ADM-6` — Enroll and create-invoice pickers only see the 100 newest students
`client/src/features/classes/ClassDetail.tsx:297` · correctness · confirmed

EnrollModal and InvoiceFormModal (Tuition.tsx:579) load `studentsApi.list('', 'studying', {limit: 100})` and search on the client. The server caps limit at MAX_LIMIT=100 and orders students by id DESC. The same truncation hits the class pickers. Attendance.tsx:45 and Classes.tsx:278 ask for `limit: 200`, which is silently capped at 100, so the comment 'MEDIUM-4 ... thấy hết lớp' is wrong. StudentDetail grade form, Trials listClasses and the ClassFormModal teacher/room selects are also capped.

- **Kịch bản lỗi:** A center has 150 studying students. Student #20, an older record, never appears in the 'Thêm học viên' search ('Không tìm thấy') and cannot be picked when creating the monthly invoice. With more than 100 classes, older active classes are missing from the attendance dropdown.
- **Đề xuất:** Use server-side search (the `search` param is already supported) with a debounced typeahead instead of preloading 100 rows. For classes, page through results or add a lightweight `/classes/options` endpoint.

#### `client-admin/ADM-7` — Reset-requests panel on Teachers page shows other centers' usernames and parent phones
`client/src/features/people/ResetRequests.tsx:37` · security · confirmed

ResetRequestsSection renders GET /auth/reset-requests. The handler (server/src/modules/auth/auth.routes.ts:224-236) selects from reset_requests with no center filter (LIMIT 200 across all tenants), and the table has no center_id. Only the process step checks the center.

- **Kịch bản lỗi:** Any center admin with users.view opens /app/teachers. The 'Yêu cầu đặt lại mật khẩu' table lists staff usernames and parent phone numbers from every other tenant that submitted forgot-password, with timestamps. This leaks other tenants' PII and gives attackers usernames to target.
- **Đề xuất:** Resolve and store center_id when the request is created (or join users/parents at read time) and filter by reqCenterId unless the caller is superadmin or has scope 'all'. Add a cross-tenant test.

#### `client-admin/ADM-9` — Focusing a secret field clears it, and saving then wipes the stored credential
`client/src/features/notifications/ZaloReminders.tsx:222` · correctness · confirmed (ban đầu: medium)

The access-token input's onFocus replaces the masked value with ''. If the user leaves it empty and saves, '' contains no '•', so it is sent, and the server stores '' (zalo.routes.ts:57-80). PaymentConfig.tsx:187-192 does the same for `pay_vnp_hashsecret`. validate() turns '' into undefined, savePaymentConfig still writes '', and when VNPay is disabled nothing stops the save.

- **Kịch bản lỗi:** An admin tabs from 'OA ID' to the template fields, passing through the token input, edits a template and saves. The Zalo access token is deleted, the status flips to 'demo', and the daily reminders stop sending real messages without any error.
- **Đề xuất:** Track a separate `tokenTouched` flag and only include the secret when the user typed a non-empty value. Show the mask as a placeholder instead of the value. Server: treat '' for secret keys as 'keep existing' unless an explicit clear flag is sent.

#### `client-core/CORR-1` ✔︎ — Reloading the page or opening a new tab logs the user out: RoleGuard checks the in-memory token, which is always empty after load
`client/src/app/App.tsx:82` · correctness · confirmed

Commit e36289d (D4) moved the access token into a module variable, and the comment says reload should go through a silent /refresh. RoleGuard still decides 'authed' with !!getToken(). After any page load that value is null, so the guard redirects to /login before any API call can trigger tryRefresh(). The 30-day HttpOnly refresh cookie and edu_user are never used on boot. Login and ParentLogin do not try a silent refresh either.

- **Kịch bản lỗi:** An admin on /app/students presses F5, opens a student in a new tab, or relaunches the installed PWA, and is sent to /login every time. A parent pays through VNPay: ChildDetail opens pay_url in a new tab, and VNPay redirects that tab back to /parent/thanh-toan-ket-qua. That tab has no memory token, so RoleGuard sends the parent to /parent/login.
- **Đề xuất:** Export tryRefresh() and run it once on boot, or inside RoleGuard when !getToken() && getUser(). Show RouteFallback while it runs and redirect only if refresh fails. Add a vitest case covering 'reload with a valid cookie stays logged in'.

#### `client-core/CORR-2` — Printed tuition receipt shows 'NaNđ' as the remaining balance
`client/src/shared/components/ReceiptModal.tsx:58` · correctness · confirmed

The remaining balance is computed as invoice.amount - invoice.discount - invoice.paid. The invoices table has no discount column, and 'discount' appears nowhere in server/src, so invoice.discount is undefined. The result is NaN, and formatVND(NaN) renders 'NaNđ'. Every other screen computes amount - (paid || 0) (InvoiceDetail.tsx:16, Tuition.tsx:498/720, ChildDetail.tsx:299). So even if discount existed, this receipt would subtract it twice. The InvoiceItem type at tuition.api.ts:14 declares a field the API never returns.

- **Kịch bản lỗi:** A cashier opens any invoice (Tuition list or InvoiceDetail), clicks Biên lai, then In. The printed A4 receipt reads 'Còn lại: NaNđ'. If paid is null it is NaN as well.
- **Đề xuất:** Use invoice.amount - (invoice.paid || 0), the same as InvoiceDetail. Remove discount from InvoiceItem, or implement it end-to-end on the server. Add a unit test for the receipt arithmetic.

#### `client-portals/COR-1` — Editing a draft or scheduled homework publishes it immediately
`client/src/features/homework/HomeworkFormModal.tsx:520` · correctness · confirmed

In edit mode, homeworkApi.update sends title/content/dates/max_score/rubric_id/attachments but never `status` or `publish_at`, and edit mode does not render the publish section at all. The server PUT /homework/:id passes `status: body.status` (undefined) and `publish_at: body.publish_at || null`, then updateHomework does `const status = data.status || 'published'` (server/src/modules/homework/homework.service.ts:565). So any save from the edit modal sets status='published' and clears publish_at. The PUT route also emits no HomeworkPublishedEvent, so the publish happens without the Zalo notification.

- **Kịch bản lỗi:** An admin schedules a quiz for Monday 08:00, then opens Edit to fix a typo and saves. The quiz goes live to every parent right away, publish_at is wiped, and no notification is sent. The same thing happens in the Reuse flow: Homework.tsx:133 opens the edit modal on the freshly copied draft, and the teacher's first save publishes the copy (due_date=null) instead of keeping it as a draft.
- **Đề xuất:** In edit mode, send the current `status` and `publish_at` (from `initial`, or a publish section shown in edit mode too). On the server, make status default to `current.status` when it is undefined, not 'published'. Add an integration test: PUT without status keeps the draft as a draft.

#### `client-portals/COR-2` — Saving in edit mode can delete every existing attachment and its file
`client/src/features/homework/HomeworkFormModal.tsx:528` · correctness · confirmed

`attachments` starts as `initial?.attachments ?? []`, but list rows never include attachments (listHomework does not select them). The real list comes from homeworkApi.get(initial.id) in an effect whose failure is swallowed (`.catch(() => {})`, line 190). submit() always sends `attachments: attachments.map(...)`. If the GET has not resolved yet or has failed, it sends `[]`, and server syncAttachments deletes every attachment row and unlinks the physical files (homework.service.ts:659-685).

- **Kịch bản lỗi:** A teacher on a slow mobile connection opens Edit, taps 'Tomorrow' for the due date and taps Save within about 2 seconds, before GET /homework/:id returns. Or the GET times out after its single retry. PUT goes out with attachments: [], all worksheet PDFs are deleted from disk, and nothing tells the teacher.
- **Đề xuất:** Send `attachments` only when the user actually changed them (attDirty) or after the GET has loaded successfully, and leave the field undefined otherwise; the server already treats undefined as 'keep'. Keep Save disabled, or show an error, while attachments are loading or failed to load.

#### `client-portals/COR-3` — BankQuestionForm has no key, so Save can overwrite a different question
`client/src/features/homework/QuestionBank.tsx:218` · correctness · confirmed

`{(showForm || editing) && <BankQuestionForm initial={editing} .../>}` renders at the same tree position with no `key`. BankQuestionForm seeds every field once from `initial` through useState initializers. When `editing` switches from question A to B, or from 'new' (showForm) to an existing question, React keeps the component and its state, while `initial` now points to the other question. save() calls `homeworkApi.bankUpdate(initial.id, payload)` with the old form contents. Clicking 'Add' while editing A also leaves the form in edit-A mode.

- **Kịch bản lỗi:** A teacher clicks Edit on question A (form shows A), then clicks Edit on question B in the list below, which stays visible. The form still shows A's text and answers, Save sends PUT /bank/questions/B with A's content, and B is silently corrupted. Another path: open 'Add', type a new question, click Edit on an existing question, then Save. The existing question is overwritten with the new text.
- **Đề xuất:** Add `key={editing ? `edit-${editing.id}` : 'new'}` to BankQuestionForm, and have the Add button clear `editing`.

#### `client-portals/COR-4` — Parent overview hides all pending homework once a child has 20 completed items (PostgreSQL NULLS LAST)
`server/src/modules/parent/parent.service.ts:318` · correctness · confirmed

The homework list that feeds ChildDetail's HomeworkTab uses `ORDER BY hc.id ASC, ... LIMIT 20`. The query came over from SQLite, where NULLs sort first, so not-completed rows (hc.id IS NULL) used to come first. PostgreSQL defaults to NULLS LAST for ASC, so completed rows come first (oldest completion first) and pending rows are cut off by LIMIT 20. pg-compat does not rewrite this.

- **Kịch bản lỗi:** A student in 2 classes completes homework weekly. After about 20 completions, every new assignment and quiz disappears from the parent portal: the Todo and Overdue groups are empty, and the parent cannot submit or take quizzes. They only see the 20 oldest completed items.
- **Đề xuất:** Use `ORDER BY (hc.id IS NOT NULL), (h.due_date IS NULL), h.due_date ASC` (or `hc.id ASC NULLS FIRST`), and add a test with more than 20 completions plus 1 pending item.

#### `cross-cutting/SEC-2` — Password-reset request list is not tenant-scoped: every center admin sees all tenants' usernames and phone numbers
`server/src/modules/auth/auth.routes.ts:224` · security · confirmed

GET /auth/reset-requests runs `SELECT id, identifier, kind, status, created_at FROM reset_requests ... LIMIT 200` with no center filter, and the reset_requests table has no center_id column. Any user with users.view (every center admin) can read the identifiers (staff usernames and parent phone numbers) of every tenant. The process endpoint also loads the request by id alone, so tenant isolation rests entirely on the later target.center_id comparison, which SEC-1 bypasses.

- **Kịch bản lỗi:** A parent of center B submits forgot-password with their phone number. The admin of center A opens /app reset requests and sees center B's parent phone and staff usernames. This is cross-tenant PII disclosure, and it hands an attacker the request ids needed for SEC-1.
- **Đề xuất:** Resolve and store center_id when the request is created (from the Host via resolvePublicCenter, or from the matched account), then filter list and process by reqCenterId(req). Add a two-center test.

#### `cross-cutting/OPS-1` — CI fails on every push for three independent reasons, including a smoke test that can never pass
`.github/workflows/ci.yml:74` · ops · confirmed

(1) The lint job runs format:check, which fails on 63 files. (2) The test job runs the server suite, which is non-deterministic under parallel files (see TEST-1). (3) The build job's smoke test starts `node server/dist/index.js` with no DATABASE_URL, so config/env.ts throws '[CONFIG] Thiếu DATABASE_URL' at import and the process exits. It also curls port 3001 while the server defaults to PORT 4000. Because build `needs: [lint, test]`, the build job never runs today, and if it did it would always fail.

- **Kịch bản lỗi:** Any push or PR to main shows a red pipeline, so regressions such as the dead middleware tests (TEST-2) or broken boot (OPS-2) cannot be told apart from the known noise, and CI gives no merge gate.
- **Đề xuất:** Run `npm run format` once and commit. Restore --test-concurrency=1 (TEST-1). In the build job, add a postgres service with DATABASE_URL and PORT, and curl the same port (or curl /api/live after setting PORT=3001). Consider a `needs`-independent build job.

#### `cross-cutting/TEST-1` — Server test suite is non-deterministic: files run in parallel and each one drops and recreates the same database
`server/package.json:35` · testing · confirmed

Commit 600277a removed `--test-concurrency=1` from the test script. node --test now runs test files in parallel subprocesses (availableParallelism-1), but every DB test file calls setupTestDb(), which DROPs every public table and recreates the schema in the shared educenter_test database, then TRUNCATEs in beforeEach. The measured run gives 369 tests: 157 pass, 2 fail, 210 cancelled. The errors are 23505 duplicate pg_type 'centers' (concurrent CREATE TABLE), 42P01 relation does not exist (tables dropped by a sibling file), 40P01 deadlock, and 'Cannot use a pool after calling end'.

- **Kịch bản lỗi:** The local run and the CI runner (4 vCPU, so 3 concurrent files) cancel most of the DB-backed suites (schema, consistency, students.scope, uploads, zalo…), so security regression tests do not actually guard anything.
- **Đề xuất:** Add `--test-concurrency=1` back. Longer term, give each test file its own schema or database (for example CREATE SCHEMA test_<pid> plus search_path) so the suite can run in parallel safely.

#### `cross-cutting/OPS-2` — Committed HEAD ignores server/.env (env.ts is evaluated before any dotenv.config()); the uncommitted fix loads three .env files with implicit precedence
`server/src/config/env.ts:9` · ops · confirmed

On HEAD the only dotenv.config() is in db/pg-compat.ts, but dist/index.js requires ./config/env (line 43) before anything loads pg-compat. env.ts therefore reads process.env before .env is loaded and throws 'Thiếu DATABASE_URL' when variables come from server/.env, which is what DEPLOYMENT.md and ecosystem.config.js prescribe. The uncommitted change fixes this but calls dotenv.config() three times (cwd, ../../.env, ../../../.env). That silently fills gaps from the repo-root .env, which in this checkout holds dev values (SEED_DEMO, TEST_DATABASE_URL…). pg-compat still has a redundant fourth config() call. dotenv 18 also prints '◇ injected env (N) from .env' to stdout on each call (visible in the test log), which puts non-JSON lines into production structured logs.

- **Kịch bản lỗi:** An operator deploys HEAD per DEPLOYMENT.md (server/.env plus pm2 start), and every worker crashes at boot. With the uncommitted patch, a forgotten variable in server/.env is silently taken from a dev .env at the repo root.
- **Đề xuất:** Commit a single explicit load at the very top of env.ts: `dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true })`. Remove the extra paths and the dotenv call in pg-compat.ts.

#### `cross-cutting/COR-1` — VNPay production URLs read from undocumented env vars; docs tell operators to set an unused VNPAY_URL
`server/src/services/vnpay.ts:10` · correctness · confirmed

vnpay.ts reads process.env.VNPAY_PAY_URL and VNPAY_API_URL directly, bypassing config/env.ts. config/env.ts defines VNPAY_URL, which nothing reads. DEPLOYMENT.md step 4 and server/.env.example tell operators to set VNPAY_URL, README says to edit the constant in vnpay.ts, and VNPAY_API_URL (used by the querydr reconcile job) is documented nowhere.

- **Kịch bản lỗi:** A production deploy that follows DEPLOYMENT.md sets VNPAY_URL=https://www.vnpayment.vn/... Parents are still redirected to sandbox.vnpayment.vn with production TMN credentials, so payments fail. The reconcile job keeps querying the sandbox API, so stuck pending transactions are never resolved.
- **Đề xuất:** Move both URLs into config/env.ts (VNPAY_PAY_URL, VNPAY_API_URL) with validation. Fail fast or warn in production when they point to sandbox. Fix DEPLOYMENT.md, both .env.example files and README.

#### `server-core/SEC-2` — GET /auth/reset-requests returns password-reset requests from every center (usernames and parent phones)
`server/src/modules/auth/auth.routes.ts:228` · security · confirmed

The query is `SELECT ... FROM reset_requests ORDER BY ... LIMIT 200`. It has no tenant filter, and the reset_requests table (schema.ts:1413) has no center_id column. Any center admin (users.view is part of admin's ALL_PERMS('center')) sees staff usernames and parent phone numbers belonging to all other tenants. The process step also resolves parent targets with `SELECT ... FROM parents WHERE phone = ? .get()` (line 259). parents are UNIQUE(center_id, phone), so when the same phone exists in two centers it picks an arbitrary row. The result is 403s for the correct admin or a reset of the wrong account when a superadmin processes it.

- **Kịch bản lỗi:** An admin of center A opens the reset-requests screen and sees the phone numbers and usernames of parents and staff from centers B, C, ... who requested resets. The leak is cross-tenant PII, and it also hands an attacker valid usernames for SEC-1. A parent with the same phone registered at two centers asks for a reset; the superadmin processes it and the other center's account gets reset.
- **Đề xuất:** Add center_id to reset_requests, set from the forgot-password body/Host. Filter the list by reqCenterId (superadmin sees all). Resolve the target scoped by (center_id, phone/username).

#### `server-core/SEC-4` — Parent-to-student linking (student code + DOB) can be brute-forced; parents self-register at any center
`server/src/modules/parent/parent.service.ts:196` · security · confirmed

linkStudent only checks student code + DOB. Failed attempts are not counted and nothing locks out per student or per parent. Student codes default to `HV` + 6 timestamp digits (students.service.ts:119) and are printed on receipts. A child's DOB lies in a ~5,000-day range. POST /parent/register (parent.routes.ts:39-56) lets anyone create a parent account at any center_id from the request body, limited only by loginRateLimit (10/min/IP). Each parent account gets about 60 POSTs per 15 min from writeRateLimit.

- **Kịch bản lỗi:** From one IP an attacker registers about 10 parent accounts per minute at the victim's center. After 15 minutes they have about 150 accounts × 60 link attempts ≈ 9,000 DOB guesses for a known student code, which covers every plausible DOB. The successful link exposes the child's attendance, grades, homework files, schedule, invoices and payment flows.
- **Đề xuất:** Track failed link attempts per (center, student_code) and per parent, and lock out after a few failures. Better: require a one-time link code generated by the center, or staff approval of links. Add per-IP throttling on register.

#### `server-data/DATA-1` ✔︎ — pg-compat appends RETURNING id to INSERTs on id-less tables idempotency_keys and quiz_essay_scores, so both always fail
`server/src/db/pg-compat.ts:204` · correctness · confirmed

makeStatement() adds ' RETURNING id' to every INSERT whose table is missing from NO_ID_TABLES. Two tables have no id column (composite or text PK) and are missing from that set: idempotency_keys (PK key) and quiz_essay_scores (PK homework_id, student_id, question_id, criterion_id, added in v21). I checked this read-only with EXPLAIN on educenter_test, and both statements fail with 'column "id" does not exist'.

- **Kịch bản lỗi:** (a) middleware/idempotency.ts:56 stores the response through db.prepare(...).run(). The insert throws, and the .catch only logs a warning, so no key is ever saved. The client retries POST /invoices/:id/payments or a refund with the same per-intent Idempotency-Key after a network timeout, and the payment or refund is applied a second time. (b) quiz.service.ts:629 runs the essay-score upsert inside tx.prepare, which raises 42703, so every POST grade-essay returns 500 and essay grading from the latest commit never works.
- **Đề xuất:** Add 'idempotency_keys' and 'quiz_essay_scores' to NO_ID_TABLES. A more robust fix is to append RETURNING id only when the caller uses lastInsertRowid, or to read id-bearing tables from information_schema once at boot. Add a real-PG test for both inserts; the current essay test mocks db.prepare and never reaches this code.

#### `server-data/DATA-2` ✔︎ — sendTuitionReminder orders by ps.id, a column parent_students does not have, so every Zalo tuition reminder fails
`server/src/services/zalo.ts:394` · correctness · confirmed

The recipient subqueries use 'FROM parent_students ps ... ORDER BY ps.id LIMIT 1'. parent_students has a composite PK (parent_id, student_id) and no id column; pg-compat even lists it in NO_ID_TABLES. PostgreSQL rejects the whole statement. I confirmed with a read-only EXPLAIN on the test DB: 'column ps.id does not exist'. This was introduced in commit e36289d (today).

- **Kịch bản lỗi:** An admin clicks 'Nhắc' (POST /invoices/:id/remind), or the per-minute scheduler reaches reminder_hour. sendTuitionReminder throws 42703 before writing any log row. The manual path returns 500. The scheduler catches the error per invoice and reports it as 'failed'. No overdue or upcoming ZNS is ever sent, for any center. The zalo-recipient and zalo-consent tests cover this path, but they were cancelled because of the test-runner problem in DATA-7.
- **Đề xuất:** Order by a column that exists, for example ORDER BY ps.created_at, ps.parent_id. Fetch phone, id and zalo_consent in one lateral join instead of two correlated subqueries.

#### `server-data/DATA-3` — reset_requests has no center_id, so every center's admins can see and process all tenants' password-reset requests
`server/src/db/schema.ts:1413` · security · confirmed

reset_requests stores only (identifier, kind, status) with no tenant column. GET /reset-requests (auth.routes.ts:230) returns the latest 200 rows with no center filter to any user holding users.view. In the process endpoint, `SELECT ... FROM parents WHERE phone = ?` picks an arbitrary parent when the same phone exists in several centers. parents is UNIQUE(center_id, phone), so this is allowed.

- **Kịch bản lỗi:** A parent of center B submits 'quên mật khẩu' with phone 09xxxxxxx. The admin of center A opens the reset-request list and sees center B's parent phone numbers and staff usernames, which is cross-tenant PII useful for targeted credential attacks. If that phone also exists in center A, A's admin processes the request and resets A's parent account, a person who never asked for it, then hands out a temporary password.
- **Đề xuất:** Add center_id (resolved at request time from subdomain or center selection) plus a migration. Filter the list and the process endpoint by reqCenterId, and resolve parents by (center_id, phone).

#### `server-data/DATA-5` — PUT /zalo/config overwrites the real refresh token and app secret with the masked values from GET
`server/src/modules/zalo/zalo.routes.ts:81` · correctness · confirmed

GET /zalo/config returns zalo_refresh_token and zalo_app_secret masked ('abcd••••••••wxyz'). The client keeps the whole response in state and sends it back on save; ZaloReminders.tsx:106-110 strips only a masked zalo_access_token. The server loops over all ZALO_CONFIG_KEYS present in the body and calls setCenterSetting for each, without rejecting masked values.

- **Kịch bản lỗi:** An admin changes reminder_hour from 08:00 to 09:00 and saves. center_settings now holds 'abcd••••••••wxyz' as zalo_refresh_token and zalo_app_secret. The next token refresh posts the masked secret to oauth.zaloapp.com and fails. When the access token expires (about 25h), all ZNS sending stops until someone re-enters both secrets by hand.
- **Đề xuất:** On the server, skip any secret key (zalo_access_token, zalo_refresh_token, zalo_app_secret) whose value contains '•' or equals the masked form; omitting the key should mean 'keep'. Also stop returning secrets to the client at all, and return a boolean such as has_refresh_token instead.

#### `server-data/DATA-7` — Server test suite is non-deterministic: test files run in parallel against one shared Postgres database (210 of 369 tests cancelled)
`server/package.json:35` · testing · confirmed

`node --test` runs test files concurrently by default (availableParallelism-1). Each file's setupTestDb() drops every public table and recreates the schema (test-utils.ts:42) in the same educenter_test database. The measured run reports tests 369, pass 157, fail 2, cancelled 210. The errors are 'duplicate key ... pg_type_typname_nsp_index', 'relation "refresh_tokens" does not exist', 'deadlock detected' and 'Cannot use a pool after calling end'. CI's ubuntu-latest has several vCPUs, so the same race applies there.

- **Kịch bản lỗi:** Real defects pass unnoticed because their tests are cancelled rather than failing on assertions: the ps.id reminder failure (DATA-2), the proactive refresh failure (DATA-6), and the consent and recipient tests. Separately, the essay-grading suite mocks db.prepare and so never exercises pg-compat (DATA-1). setupTestDb also skips createIndexes, so production index DDL is never executed in tests.
- **Đề xuất:** Add `--test-concurrency=1` to the test script, or give each test file its own schema or database (CREATE SCHEMA test_<pid>; SET search_path). Make setupTestDb run the same initDatabase steps as production, including createIndexes. Add at least one non-mocked PG test per service that writes to an id-less table.

#### `server-domain/SEC-1` — Teacher row filter in the students module fails open when teacher_id is null
`server/src/modules/students/students.service.ts:47` · security · confirmed

listStudents and getStudentDetail only narrow a teacher to their own classes when `opts.teacherId` is truthy. students.routes.ts:38/51 passes `req.user.teacher_id`, not the role or the RBAC 'own' scope. When a role='teacher' user has teacher_id NULL, the filter is skipped and the teacher reads every student in the center: phone, address, dob, note, plus invoices through the detail endpoint. classes.service.ts:51 and sessions.service.ts:63 already fail closed (`1 = 0`) for this case, so students is the odd one out.

- **Kịch bản lỗi:** An admin deletes a teacher who has left (DELETE /teachers/:id). users.teacher_id is ON DELETE SET NULL, and there is no API to lock or delete a staff user (no is_active=false path anywhere). Within 15 minutes the next /auth/refresh re-reads teacher_id = null (refresh.service.ts:125-147). After that the ex-teacher's GET /api/v1/students returns all students of the center, and GET /students/:id returns any student's invoices.
- **Đề xuất:** Scope on role or permission instead of teacher_id truthiness. Use `ownScoped(req,'students.view')` or `role==='teacher'`, and when teacherId is null add `1=0`, the same way classScopeWhere does. When a teacher is deleted, also lock or unlink the linked user (bump token_version).

#### `server-domain/SEC-2` — Parent can link any child in the center by brute-forcing date of birth
`server/src/modules/parent/parent.service.ts:214` · security · confirmed

linkStudent accepts student_code + dob as the only proof that a parent owns a child. Parent self-registration is open to anyone: any center_id, no phone verification (parent.routes.ts:39-56). /parent/link has no per-account or per-student attempt limit; only the global writeRateLimit of 60 POST per 15 min per IP applies, and IPv6 or several IPs get around it. The two errors also differ: 404 for an unknown code vs 400 'Ngày sinh không khớp', which lets an attacker enumerate valid codes. Auto-generated codes are guessable (HV + last 6 digits of Date.now()).

- **Kịch bản lỗi:** An attacker registers a parent account at center X, learns a classmate's code (e.g. HV482913) and tries DOBs over a ~3-year window (~1100 values). From 5 IPs that takes about 1 hour. After linking, the attacker sees the child's grades, attendance, invoices and teacher, and can submit leave requests, homework and quiz attempts for the child.
- **Đề xuất:** Add a per-parent and per-student failed-attempt counter with lockout, and return one generic error for both failure cases. Better, link through a staff-issued one-time code or staff approval (parent_students pending state), and notify the parents already linked.

#### `server-domain/COR-1` — Changing a class's teacher moves past payroll to the new teacher
`server/src/modules/classes/classes.service.ts:380` · correctness · confirmed

updateClass overwrites classes.teacher_id with no history. calcPayroll and calcPayrollBulk (payroll/payroll.service.ts:37-42, 70-74) assign every session to the class's current teacher_id at query time, and payroll is never snapshotted. Reassigning a teacher therefore rewrites every earlier month's payroll for both teachers.

- **Kịch bản lỗi:** Teacher A teaches class X from January to June; in July the admin assigns teacher B. Payroll for March now shows B paid for X's March sessions and A with 0, so A's pay stub changes after the fact and the March totals no longer match what was paid.
- **Đề xuất:** Record who actually taught each session (sessions.teacher_id set on generation, attendance or check-in) and calculate payroll from that, or snapshot monthly payroll once it is approved.

#### `server-homework/HW-1` — Editing any draft/scheduled homework silently publishes it (PUT defaults status to 'published')
`server/src/modules/homework/homework.service.ts:565` · correctness · confirmed

updateHomework does `const status = data.status || 'published'`, and the route passes `publish_at: body.publish_at || null` (homework.routes.ts:692-693). The client edit flow (client/src/features/homework/HomeworkFormModal.tsx:520-529) never sends `status` or `publish_at`. So every UI edit of a draft or scheduled homework sets status='published' and clears publish_at. It also skips HomeworkPublishedEvent, so the Zalo notification never goes out. Omitted max_score, rubric_id and content are wiped to null the same way (routes.ts:690-694), which contradicts the 'undefined = keep' rule used for due_date/close_date.

- **Kịch bản lỗi:** A teacher saves a draft quiz for next week, then opens it and fixes a typo in the title. PUT is sent without status, so the quiz is published to parents at once and its schedule is lost. The client then calls PUT /:id/quiz. If a student starts an attempt in between, saveQuiz fails with 'Đã có học viên làm bài' and the edit is left half-applied.
- **Đề xuất:** In updateHomework, treat an undefined status or publish_at as 'keep the current value' (load them with `current`). Emit HomeworkPublishedEvent when the status moves to published. Apply the same keep-if-undefined rule to max_score, rubric_id and content. Add a route-level test: PUT on a draft without status keeps it a draft.

#### `server-homework/HW-2` ✔︎ — Teacher-uploaded homework attachments can never be downloaded
`server/src/shared/uploadAccess.ts:27` · correctness · confirmed

GET /uploads/:filename is the only file-serving route (app.ts:101). Its access check looks up the file only in `homework_submissions.file_url`. Files uploaded through POST /api/v1/uploads are stored only in `homework_attachments`, so the lookup returns 404 for every role, superadmin included. The parent portal also never returns attachments (parent.service.ts:307-320), and the staff UI shows only the URL text (HomeworkFormModal.tsx:889). The upload feature added in cb6ceec stores files that nobody can open.

- **Kịch bản lỗi:** A teacher uploads worksheet.pdf, attaches it and publishes. Any GET /uploads/hw_<uuid>.pdf returns 404 'Không tìm thấy file', so students never see the material.
- **Đề xuất:** In checkUploadAccess, also resolve `homework_attachments` joined to `homework` (staff in the same center; parents only for published homework whose class or targets include their child). Return attachments in the parent homework API. Add an integration test for GET of an attachment.

#### `server-homework/HW-3` — Assigning to several classes shares one physical file; deleting or editing one homework deletes it for all
`server/src/modules/homework/homework.service.ts:352` · correctness · confirmed

createHomeworkBatch calls insertHomeworkTx once per class with the same `attachments` array, so N homework rows point to the same /uploads/hw_x file. deleteHomeworkCascade (homework.repo.ts:138) and syncAttachments (homework.service.ts:683) delete the physical file without checking whether other rows still reference it. reuseHomework copies files for exactly this reason (P1-3), but multi-class creation does not.

- **Kịch bản lỗi:** A teacher assigns 'Unit 3' with a PDF to classes A, B and C, then deletes the homework for class A (or removes the attachment from A's copy). The file is unlinked from disk, and B and C now reference a missing file: data loss in normal use.
- **Đề xuất:** Before unlinking, check that no other homework_attachments or homework_submissions row references the URL. Alternatively, copy the file per class in createHomeworkBatch as reuseHomework does.

#### `server-homework/HW-5` — Rubric essay scores are summed raw, not scaled to each essay question's points
`server/src/modules/homework/quiz.service.ts:653` · correctness · confirmed

gradeQuizEssay computes total = MAX(auto) + SUM(all criterion scores across all essay questions). Rubric criteria have their own max_score, unrelated to quiz_questions.points, while homework.max_score is the sum of question points. The only guard is `total > max_score → 400`. The test fixture only passes because it uses essay points 10 and rubric total 10.

- **Kịch bản lỗi:** Quiz: 8 multiple-choice questions at 1 point plus 1 essay at 2 points (max 10), rubric 6+4=10. A student with 0/8 on the multiple choice gets 5/10 on the rubric (meant as 50% of the essay, about 1 point), and the stored total is 5/10 instead of 1/10. A student with 8/8 who gets 5/10 on the rubric totals 13 > 10, so the teacher gets a 400 and cannot grade. With 2 essay questions sharing one rubric, full marks always overflow.
- **Đề xuất:** Scale per question: essay_score_q = question.points * sum(criteria) / rubric.total_score. Store or compute it per question, then total = auto + Σ essay_score_q. Add a test where rubric total ≠ essay points.

#### `server-money/PAY-1` — VNPay 2.1.0 checksum computed over raw (un-encoded) values; pay URL emitted un-encoded
`server/src/services/vnpay.ts:38` · correctness · confirmed

buildSignData joins `k=v` with raw values and buildVnpayUrl appends that same raw string as the query (`${VNPAY_PAY_URL}?${signData}`). The request says vnp_Version 2.1.0 and signs with HMAC-SHA512. VNPay's official 2.1.0 samples (Node sortObject: encodeURIComponent(v).replace(/%20/g,'+'); PHP: urlencode($key).'='.urlencode($value)) hash the URL-encoded values. verifyVnpayReturn also re-hashes the decoded query values without re-encoding them. The comment 'KHÔNG encode — đúng chuẩn mẫu VNPay Node.js' misreads `qs.stringify(..., {encode:false})`, which the sample applies to values it has already encoded. The tests (payments.ipn.test.ts vnpaySign) sign with the same algorithm, so they cannot catch this. Not verified against the live sandbox, so treat this as PLAUSIBLE until checked with real credentials.

- **Kịch bản lỗi:** A parent clicks Pay. vnp_ReturnUrl='https://x/api/v1/payments/vnpay-return' always contains ':' and '/', and vnp_OrderInfo='Thanh toan hoc phi HD12' contains spaces. VNPay hashes 'https%3A%2F%2F...' and 'Thanh+toan+...', the merchant hashed the raw strings, and VNPay rejects with code 70 (invalid signature). If any IPN does get through, the server's own verification fails on the space→'+' difference and replies 97, so online payment never confirms.
- **Đề xuất:** Hash `encodeURIComponent(k)=encodeURIComponent(v).replace(/%20/g,'+')`, sorted, both when building the URL and when verifying return/IPN (filter to vnp_* keys). Use the same encoded string as the query. Add a test against a known-good VNPay sandbox vector instead of self-signed fixtures.

#### `server-money/PAY-2` — Refund re-opens the full refunded amount as debt and triggers overdue reminders
`server/src/modules/payments/payments.service.ts:461` · correctness · confirmed

refundInvoice inserts a negative payment and recomputes the status against the unchanged invoice.amount. Any refund therefore turns the refunded sum back into outstanding debt (status partial/unpaid). Overpayment is blocked everywhere, so a refund can never offset an overpayment; it always creates debt. updateInvoice refuses to change the amount once confirmed payments exist, and deleteInvoice refuses to delete, so staff cannot clear the phantom debt. refund.test.ts encodes this behavior ('Học viên nghỉ giữa chừng' → status partial).

- **Kịch bản lỗi:** A student pays 1,000,000đ and then quits. Admin refunds 400,000đ. The invoice becomes 'partial' with 400,000đ debt, shows in /invoices/debt and the dashboard debt totals, and reminderScheduler (status IN ('unpaid','partial') AND due_date < today) sends Zalo reminders asking the parent to pay back the money the center just refunded. Staff cannot edit the amount or delete the invoice.
- **Đề xuất:** Record the refund as an invoice adjustment (reduce the billed amount or add a credit-note line) so net billed = net paid. At minimum, compute status against (amount − refunded) and exclude refunded portions from debt queries and reminders.

#### `server-money/PAY-3` — Successful VNPay charge silently dropped on overpay or deleted invoice; no record, no alert
`server/src/modules/payments/payments.service.ts:130` · correctness · confirmed

When the IPN's amount would exceed the invoice remainder, confirmVnpayTxn marks the txn 'failed' and returns reason 'overpay'. handleVnpayIpn maps that to '99 Unknown error'. Nothing logs, audits or alerts. VNPay retries, and the retry hits status 'failed' → '02', so the money VNPay already captured is never recorded. Separately, deleteInvoice cascades payment_txns, so an IPN for a txn whose invoice was deleted returns '01 not found', again with no trace.

- **Kịch bản lỗi:** The remaining debt is 1,000,000đ and the parent opens the VNPay URL (txn amount 1,000,000đ). Meanwhile staff records 300,000đ cash at the desk. The parent completes the VNPay payment and the IPN arrives: 300k + 1,000k > 1,000k → txn set to failed, response 99. The parent's bank shows 1,000,000đ debited, the center has no payment row and no alert, and only the 'failed' txn status remains.
- **Đề xuất:** On overpay, still record the captured money (for example as a confirmed payment and a credit for the excess, or a 'needs_review' state), reply 00 to VNPay, and sendAlert plus an audit entry. Block deleting invoices that have pending VNPay txns, or alert when an IPN references a missing invoice.

#### `server-money/REF-1` — Phone-based referral match is not tenant-scoped: cross-center reward and data leak, plus a forgeable claim
`server/src/services/referrals.ts:100` · security · confirmed

doAfterInvoicePaid looks up `referrals WHERE referred_phone = ? AND status='pending'` with no center filter. The referrals table has no center_id, and the referrer's center is only implied by the parent. It then writes referred_student_id = <student of another center> into that row and issues credits with the student's center_id to a parent of a different center. The referral is created by the public trial-registration endpoint (public.routes.ts:232) for any phone the submitter types, with no check that the phone is new or unenrolled.

- **Kịch bản lỗi:** Parent P in center X submits public trial forms at center X with their referral code and the phone numbers of students at center Y. When one of those center-Y students pays their first invoice, center X's referral row is claimed. P receives a 200,000đ credit stamped center_id=Y, center Y's own legitimate referral (if any) stays pending, and center X staff see the center-Y student's name in GET /referrals (LEFT JOIN students on referred_student_id).
- **Đề xuất:** Add center_id to referrals (set from the trial-registration center) and filter both lookups by student.center_id. Only match referrals created before the student's enrollment, and ignore phones already belonging to existing students or parents at registration time.


### MEDIUM (81)

#### `client-admin/ADM-5` — Trials status list doesn't match server enum: 3 of 5 options fail and reverting a converted trial allows a duplicate student
`client/src/features/admissions/Trials.tsx:18` · correctness · confirmed (ban đầu: high)

The client uses STATUSES = ['new','contacted','trialed','enrolled','lost']. The server uses TRIAL_STATUS = ['new','contacted','converted'] (trials.service.ts:7). The row status <select> has no 'converted' option, so a converted row displays 'new'. PUT accepts a move from converted back to new/contacted. convertTrial only blocks when status === 'converted'.

- **Kịch bản lỗi:** (1) Staff picks 'Đã học thử', 'Đã nhập học' or 'Không theo' and gets a 400 'Trạng thái không hợp lệ' every time. (2) Filtering by any of those three makes the server ignore the invalid filter, so ALL trials are listed under that label. (3) For a converted trial the select shows 'Mới'. Picking 'Đã liên hệ' sets status=contacted, the Convert button reappears, and converting again inserts a second student.
- **Đề xuất:** Make one shared status enum match the server, and render 'converted' as a read-only badge without the select. Server: reject status changes once a trial is converted.

#### `client-admin/ADM-8` — Tuition debt pill shows literal '{count} … {total}', and the summary endpoint always returns 0
`client/src/features/tuition/Tuition.tsx:292` · correctness · confirmed

The `invoices.debtStrip` locale strings use single braces ('{count} học viên còn nợ, tổng {total}', tuition.json:170), so i18next renders them literally. Separately, getDebtSummary aliases columns `as totalDebt` and `as debtorCount` without quotes (invoices.service.ts:162-163). Postgres folds these to lowercase, so `row.totalDebt` is undefined and the endpoint always returns {totalDebt:0, debtorCount:0}. The unit test mocks camelCase keys and the integration test only checks the zero case, so neither catches it. The summary is also never refetched after a payment, refund or credit.

- **Kịch bản lỗi:** An admin opens /app/tuition. The headline pill reads '{count} học viên còn nợ, tổng {total}', and even with the placeholders fixed it would show 0 debtors and 0đ.
- **Đề xuất:** Use `{{count}}`/`{{total}}` in both locales. Quote the aliases (`AS "totalDebt"`) or use snake_case and map. Add an integration test with a non-zero debt. Refetch the summary in the onDone callbacks.

#### `client-admin/ADM-10` — Lead pipeline: the 'move next' arrow on the Trial column always fails, and no action leads to Lost
`client/src/features/admissions/Leads.tsx:22` · correctness · confirmed

NEXT_STATUS.trial = 'enrolled', but the PUT /leads/:id handler explicitly rejects status 'enrolled' (leads.routes.ts:133-139), because conversion must go through /convert. No action anywhere moves a lead to 'lost', even though the column and the reopen button exist. The kanban is also built from one paginated page (20 rows), so column counts only reflect the current page.

- **Kịch bản lỗi:** Staff click → on a lead in 'Học thử' and get a 400 toast every time. Leads that went cold can never be marked lost. With 60 leads, the 'Mới' column says 3 while 25 are actually new.
- **Đề xuất:** In the trial column, make the arrow open ConvertModal. Add a 'Mark lost' action. Load the pipeline per status column, or show server-side counts per status.

#### `client-admin/ADM-11` — Attendance has no stale-response guard: switching sessions can save one session's marks into another
`client/src/features/classes/Attendance.tsx:79` · correctness · confirmed

loadAttendance(sid) sets rows and topic from whichever response arrives last, without checking that sid is still the selected session. pickClass and pickSession do not cancel in-flight loads. On a flaky mobile network, responses can arrive out of order.

- **Kịch bản lỗi:** A user selects session 10/10, then quickly 12/10. The 12/10 response arrives first, then the 10/10 response overwrites rows and topic while the dropdown shows 12/10. The user marks a few students and saves, which writes 10/10's statuses, notes and topic into session 12/10 and also sends absence notifications to parents.
- **Đề xuất:** Keep a ref of the current sessionId (or an AbortController) and ignore responses whose sid no longer matches. Warn before switching sessions with unsaved changes.

#### `client-admin/ADM-13` — Removing the last row on a page leaves an empty page with no pagination and a wrong empty state
`client/src/features/tuition/Tuition.tsx:94` · frontend · confirmed

After approve, reject or delete, every paginated list reloads the same `page` and never clamps it to `pagination.totalPages`. Pagination returns null when totalPages <= 1 (Pagination.tsx:25). The pattern repeats in Students, Classes, Leads, ReviewsAdmin, LeavesAdmin and Rooms.

- **Kịch bản lỗi:** There are 21 pending payments. The admin opens page 2 and approves the only item there. The reload returns data [] with totalPages=1, so the screen shows 'Không có thanh toán chờ duyệt' and no pager. The admin thinks the queue is empty while 20 payments wait on page 1.
- **Đề xuất:** After each load, if data is empty and page > totalPages, call setPage(max(1, totalPages)). This fits in a small shared helper or inside Pagination.

#### `client-admin/ADM-14` — Schedule slots with end <= start are accepted and slip past teacher/room conflict detection
`client/src/features/classes/Classes.tsx:396` · correctness · confirmed

ClassFormModal validates name, dates, fee and size but not the schedule slots. The server only checks the HH:MM format (classes.service.ts:68-71). The overlap test `a.start < b.end && b.start < a.end` never matches an inverted slot.

- **Kịch bản lỗi:** A user enters Monday 20:00 to 18:00 (a typo for 18:00 to 20:00). The class saves, the conflict check passes, and the same teacher or room can be double-booked on Monday evening. The schedule text displays '20:00-18:00'.
- **Đề xuất:** Reject end <= start per slot on both client and server (in normalizeSchedule) with an inline error on the row.

#### `client-core/CORR-3` — Service worker serves cached HTML first and never updates, so users run stale or broken builds after a deploy
`client/public/sw.js:24` · ops · confirmed (ban đầu: high)

Every same-origin GET except /api, including navigations and /assets, is served from cache first. The cache name is the constant 'educenter-shell-v1' and sw.js is byte-identical across deploys, so the SW never updates, the activate cleanup never runs, and the cache grows without limit. Each route URL (/app, /app/students?..., /login) is its own cache key holding whatever HTML was current when the user last visited it. On the server, express.static('/assets') falls through to the SPA fallback (app.ts:275), so a missing hashed chunk comes back as index.html with status 200. The SW then caches that HTML under the .js URL.

- **Kịch bản lỗi:** After a deploy, a user reloads /app/students. The SW returns HTML cached weeks ago, which references the old index-*.js. That file is still cached, so the old app runs against the new API. When the user opens a route whose old chunk was never cached, /assets/Payroll-old.js returns index.html. The module fails its MIME check, React.lazy rejects, and the ErrorBoundary appears. Its Retry cannot recover (see FE-2). The page stays broken until each URL has been loaded twice.
- **Đề xuất:** Use network-first for request.mode==='navigate' and never cache HTML under arbitrary URLs. Cache only /assets/* responses with a JS/CSS content-type. Version the cache per build (inject a build hash) or remove the SW. Set fallthrough:false on the /assets static mount so missing chunks return 404.

#### `client-core/SEC-1` — Service worker stores auth-protected student uploads in CacheStorage and serves them later without any auth check
`client/public/sw.js:29` · security · confirmed

Only /api is excluded from the SW. Homework submission files are served at /uploads/:filename behind requireAuth + checkUploadAccess (server app.ts:100-121). useSecureFileUrl fetches them with a Bearer header from the page, the SW intercepts, and cache.put stores the response. Later requests are answered cache-first: cache.match ignores the Authorization header and the server-side access check never runs. The cache survives logout because nothing clears it.

- **Kịch bản lỗi:** On a shared front-desk PC or family device, user A views students' submission photos and logs out. Anyone using the same browser profile can still get /uploads/<name> from CacheStorage (DevTools, or a later session), with no auth. Files that were deleted, or whose access was revoked, keep being served from cache.
- **Đề xuất:** In the SW, bypass /uploads/* and any request that carries an Authorization header. Clear caches on logout (caches.keys + delete).

#### `client-core/CORR-4` — A wrong password on staff or parent login shows 'Phiên đăng nhập đã hết hạn' instead of the real error
`client/src/shared/api/client.ts:159` · correctness · confirmed

api() treats every 401 as an expired session. /auth/login (auth.routes.ts:62) and parent login (parent.service.ts:178) return 401 for bad credentials. The client then calls tryRefresh(), calls clearAuth(), and throws Error(t('api.sessionExpired')). The server's message is discarded. If a stale edu_user is still in localStorage (which is what happens after the reload bounce in CORR-1), tryRefresh actually calls /auth/refresh, rotating the cookie and using up loginRateLimit, then retries the login and wipes the session.

- **Kịch bản lỗi:** A user types a wrong password on /login or /parent/login. The inline error under the password field says 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' instead of 'Tên đăng nhập hoặc mật khẩu không đúng'.
- **Đề xuất:** Skip refresh and expiry handling when no Authorization header was sent, or add a skipAuthRefresh option for the auth endpoints. Throw the server's body.error/code for those calls.

#### `client-core/SEC-2` — 'Log out all other devices' revokes the current session too and leaves stolen access tokens valid
`client/src/shared/components/ChangePasswordModal.tsx:56` · security · confirmed

The confirm text promises logout from 'tất cả thiết bị khác'. The endpoint /auth/logout-all calls revokeAllForOwner, which revokes every refresh token including the caller's, and it does not bump token_version or call invalidateTokenCheck. The UI shows a success toast and keeps the user inside the app.

- **Kịch bản lỗi:** A user who suspects their credentials leaked clicks the button. The attacker's access token keeps working for up to 15 minutes. About 15 minutes later the user's own next request returns 401, refresh fails because their token was revoked, and they get kicked out with 'phiên hết hạn'.
- **Đề xuất:** Server: use revokeAllForOwnerExcept(getRefreshCookie(req)), bump token_version, and call invalidateTokenCheck. Client: refresh the token afterwards. Alternatively, clearAuth + navigate to login and change the copy to 'tất cả thiết bị'.

#### `client-core/CORR-5` — Staff and parent portals share one 'edu_user' key, so concurrent sessions corrupt each other
`client/src/shared/api/client.ts:74` · correctness · confirmed

Refresh cookies are deliberately split by path (/api/v1/auth vs /api/v1/parent, with the comment 'để 2 phiên không đè nhau'). The client keeps a single localStorage 'edu_user', and tryRefresh/logout choose the endpoint from its role. Layout and RoleGuard also read it.

- **Kịch bản lỗi:** A teacher who is also a parent (common in small centers) opens /teacher in tab 1 and logs into /parent in tab 2, which overwrites edu_user with role 'parent'. After 15 minutes, tab 1 gets a 401 and tryRefresh calls /parent/refresh. Tab 1 now sends a parent token, and every staff API returns 403 (denyParents). The header shows the parent's name, and reloading tab 1 shows Forbidden. Logging out in one portal also clears the other portal's user.
- **Đề xuất:** Store the user per portal (edu_user_staff / edu_user_parent) and choose by path prefix, or derive role from the access-token payload instead of localStorage.

#### `client-core/FE-2` — ErrorBoundary cannot recover: no reset on navigation, and Retry re-throws for failed lazy chunks
`client/src/shared/components/ErrorBoundary.tsx:85` · frontend · confirmed

The 'app', 'parent' and 'teacher' boundaries wrap the whole layout (App.tsx:125/144/162), so one page crash replaces the sidebar and topbar. hasError is not reset when location changes. Retry re-renders the same subtree, and React.lazy caches a rejected import, so chunk-load failures (very likely given CORR-3) throw again every time. The only remaining exit is 'Home', which goes to the public landing page.

- **Kịch bản lỗi:** A page under /app throws, or its chunk fails to load. The user sees the fallback with no navigation. Pressing browser Back still shows the fallback because the boundary instance persists. Pressing Retry shows the same error again.
- **Đề xuất:** Add a per-page boundary inside Layout around <Outlet/> keyed by location.pathname. Detect dynamic-import errors ('Failed to fetch dynamically imported module' / ChunkLoadError) and call window.location.reload() once, guarded by sessionStorage.

#### `client-core/TEST-1` — No tests for the client auth/HTTP core, route guards, Modal or service worker
`client/src/shared/api/client.ts:112` · testing · confirmed

The 6 client test files cover only pure helpers: validation, renderMarkdown, types, locale key parity, two feature utils. Nothing tests api() (401 → refresh → retry, transient retry, timeout), RoleGuard, takePostLoginRedirect, Modal focus/stack behaviour, ReceiptModal arithmetic or sw.js.

- **Kịch bản lỗi:** The D4 commit changed token storage in client.ts without touching App.tsx RoleGuard, and the reload-logout regression (CORR-1) shipped unnoticed. The NaN receipt (CORR-2) and the wrong login error (CORR-4) would also fail a basic test.
- **Đề xuất:** Add vitest + jsdom/RTL tests: mock fetch for api() flows, render App at /app with a stored user and a mocked refresh, check ReceiptModal output, and test the Modal effect stability.

#### `client-portals/COR-5` — Parent attendance rate is shown 100 times too high
`client/src/features/parent/ChildDetail.tsx:219` · correctness · confirmed

The server already returns a percentage: `rate: Math.round((present / total) * 1000) / 10`, for example 85.7 (parent.service.ts, getChildOverview). AttendanceTab renders `(a.rate * 100).toFixed(0)%`.

- **Kịch bản lỗi:** A child attended 6 of 7 sessions. The server sends rate=85.7 and the parent sees 'Attendance rate 8570%'.
- **Đề xuất:** Render `a.rate.toFixed(0)%`, or change the API contract to a 0..1 fraction and keep the two sides consistent. Add a typed test.

#### `client-portals/COR-6` — Editing a quiz that has attempts always shows an error after half the save has gone through, and Cancel then deletes the new file
`client/src/features/homework/HomeworkFormModal.tsx:530` · correctness · confirmed

In edit mode, submit() first PUTs /homework/:id (succeeds, attachments synced), then always calls saveQuiz for kind==='quiz', even when quizLocked is true. saveQuizQuestions throws 400 when any attempt exists (quiz.service.ts:100). The catch shows an error and keeps the modal open, and orphanUrls is not cleared even though the update already attached the uploaded files. If the teacher then cancels, cleanupOrphans calls DELETE /uploads/<file> for a file that the saved attachment row now references.

- **Kịch bản lỗi:** A teacher extends the deadline of a quiz students have already started and adds a PDF. Save shows the error 'Đã có học viên làm bài, không thể sửa đề' although the new date and attachment were saved. The teacher clicks Cancel and confirms discard. The PDF is unlinked from disk and parents get a broken attachment.
- **Đề xuất:** Skip saveQuiz when quizLocked is true or the questions were not edited (`quizEdited`). Clear orphanUrls right after the update succeeds. Better still, make homework plus quiz a single server transaction.

#### `client-portals/SEC-1` — DELETE /api/v1/uploads/:filename deletes any upload with no tenant, owner or reference check
`server/src/modules/uploads/uploads.routes.ts:69` · security · confirmed

The endpoint the client uses for orphan cleanup only checks the filename format and requires homework.create, then unlinks the file. It does not check that the caller uploaded the file, that it belongs to the caller's center, or that nothing references it (homework_attachments, homework_submissions). Student submissions share the same directory and `hw_` naming. Root cause of the file loss in COR-6.

- **Kịch bản lỗi:** A teacher with own-scope (or a buggy client cleanup) calls DELETE /uploads/hw_<uuid>.jpg for a filename seen in another class's submissions or attachments. The student's submitted work is permanently deleted from disk. Staff of any tenant can do the same to any filename they learn.
- **Đề xuất:** Record the uploader and center on upload (or a pending_uploads table), allow deletion only by the uploader or same-center staff, and refuse when the file is referenced by any attachment or submission row.

#### `client-portals/COR-7` — Stale picked students outlive class changes, so the homework goes to the whole class
`client/src/features/homework/HomeworkFormModal.tsx:481` · correctness · confirmed

selectedStudents is never pruned when selectedClasses changes; the students effect only reloads the visible list. Validation counts the stale IDs, and the counter shows 'N selected'. The server's filterValidTargets drops students not enrolled in the selected classes, and an empty target list means the whole class (targetScopeCond).

- **Kịch bản lỗi:** A teacher picks class A, chooses 'Pick students' and selects 2 kids for remedial work. They realise it should be class B, swap the classes and pick nobody: the chips show no selection, but the counter says 2 selected and validation passes. The server filters the targets to [] and the homework, plus its Zalo notification, goes to every student in class B.
- **Đề xuất:** In the students effect, intersect selectedStudents with the loaded student IDs, or clear the selection when classes change. Validate against `selectedStudents.filter(id => students.some(s => s.id === id))`.

#### `client-portals/FE-1` — Field wraps whole widget groups in a <label>, so clicking label text fires the first button inside
`client/src/features/homework/HomeworkFormModal.tsx:884` · frontend · confirmed

Field (shared/components/Form.tsx:39) renders `<label className="field">` around its children. Under HTML label activation, a click on non-interactive content inside a label is forwarded to the first labelable descendant, and buttons are labelable. The homework form puts button groups inside Field, and BankQuestionForm's answers Field does the same.

- **Kịch bản lỗi:** Attachments Field: with at least one attachment, clicking the label 'Đính kèm', an attachment's name or URL text, or the hint text clicks row 0's Delete and removes the first attachment. Quick templates Field (line 765): clicking its label overwrites the typed title and content with template #1. Publish Field (line 1209): clicking its label resets 'Schedule' to 'Now'. Assign-to Field (line 701): clicking the 'N selected' text switches to whole class. QuestionBank answers Field (line 623): clicking the label sets option A as the only correct answer.
- **Đề xuất:** Give Field an `as="div"` / fieldset+legend mode for compound children, or render a <div> with a <span id> label and associate single inputs through htmlFor/useId. Never wrap button groups in <label>.

#### `client-portals/FE-2` — QuizTaker loses every answer on Escape, a backdrop tap or X, with no confirmation
`client/src/features/parent/QuizTaker.tsx:256` · frontend · confirmed

QuizTaker hands `onClose` straight to Modal. Modal closes on Escape and on backdrop mousedown, and the backdrop has tappable padding above and below the dialog on phones. Answers, including essays up to 20,000 characters, live only in component state, with no dirty-check or draft persistence. HomeworkFormModal has a dirty-check, but the student-facing quiz does not.

- **Kịch bản lỗi:** A child writes a long essay answer on a phone and taps the dimmed area under the short modal, or presses Esc on desktop. The modal closes and every answer is gone with no warning.
- **Đề xuất:** Use a tryClose with a ConfirmDialog when any answer exists (the same pattern as HomeworkFormModal), and optionally keep a draft in sessionStorage keyed by homework and student.

#### `client-portals/FE-3` — EssayGradeModal wipes unsaved scores on other questions after each save
`client/src/features/homework/EssayGradeModal.tsx:93` · frontend · confirmed

saveQuestion() calls `await load()` after a successful save. load() sets loading=true, which replaces the whole body with a skeleton, then `setInputs(pre)` rebuilds the inputs only from server scores. Scores typed for other essay questions but not saved yet are discarded.

- **Kịch bản lỗi:** A teacher fills the rubric criteria for essay Q1 and Q2, then clicks 'Save' on Q1. The modal reloads and the Q2 scores they typed vanish, so they must re-enter them.
- **Đề xuất:** After a save, merge only the saved question's scores and the totals (from the grade response or a background refetch without the loading flag), and keep the inputs for the other questions.

#### `client-portals/COR-8` — File upload uses raw XHR and never refreshes an expired access token
`client/src/features/homework/homework.api.ts:26` · correctness · confirmed

uploadFile reads getToken() and posts through XMLHttpRequest, bypassing api(), which handles 401 by calling tryRefresh() and retrying. The access token lives about 15 minutes in memory.

- **Kịch bản lỗi:** A teacher spends 20 minutes building a quiz with no other API calls, then picks a file. POST /uploads returns 401, an inline error appears, and retrying fails the same way until some other request happens to refresh the token.
- **Đề xuất:** On a 401 in uploadFile, export and await tryRefresh() and then retry once, or refresh before starting the upload.

#### `client-portals/FE-4` — Teacher attachments never reach parents
`client/src/features/parent/ChildDetail.tsx:574` · frontend · confirmed

HomeworkTab renders title, content, feedback and actions but never `h.attachments`. The parent overview SQL (parent.service.ts:309) does not select attachments either, and nothing on the parent side reads homework_attachments. The whole upload, attachment and orphan-cleanup feature in HomeworkFormModal has no consumer.

- **Kịch bản lỗi:** A teacher attaches a worksheet PDF and a listening MP3 to homework. Parents and students see only the text and have no way to open the materials.
- **Đề xuất:** Return attachments in the parent overview (or a per-homework endpoint scoped to the child), and render them in HomeworkTab with useSecureFileUrl for /uploads files and rel=noopener for links.

#### `client-portals/FE-5` — VNPay link opened with window.open after an await is blocked on iOS Safari
`client/src/features/parent/ChildDetail.tsx:320` · frontend · plausible

payVNPay awaits the API, then calls window.open(url, '_blank', 'noopener'). By then the click's user activation has been consumed on iOS Safari and some in-app browsers (such as the Zalo webview), so the popup is blocked. With 'noopener' window.open always returns null, so the code cannot detect the block and still shows the 'VNPay opened' toast.

- **Kịch bản lỗi:** A parent on an iPhone taps 'Pay with VNPay'. Nothing opens but the toast says it did, so they cannot pay online.
- **Đề xuất:** Navigate in the same tab (`window.location.assign(pay_url)`; the return URL already lands on PaymentResult), or open a blank window synchronously in the click handler and set its location after the await.

#### `cross-cutting/TEST-2` — Test glob omits middleware/ and jobs/: auth revocation, CSRF, rate-limit and VNPay reconcile tests never run
`server/package.json:35` · testing · confirmed

The script lists only test-dist/{db,modules/*,services,shared}/*.test.js. The files middleware/auth.test.ts (D2 token revocation), middleware/cookieAuth.test.ts (requireSameOrigin anti-CSRF), middleware/rateLimit.test.ts (B2 divisor, D5 per-account login limit) and jobs/vnpayReconcile.test.ts (G6) compile but are never executed. None of their 8 suites appear in the test output. Before 600277a the glob was the recursive "test-dist/**/*.test.js".

- **Kịch bản lỗi:** A regression in requireAuth's token_version check or in requireSameOrigin ships with every test passing, even though dedicated tests for exactly that behaviour exist in the repo.
- **Đề xuất:** Use `node --test --test-concurrency=1 "test-dist/**/*.test.js"` (quoted so node expands it), or add test-dist/middleware/*.test.js and test-dist/jobs/*.test.js.

#### `cross-cutting/SEC-3` — Metrics and detailed health exposed to every tenant admin (system.manage is granted to admin with scope center)
`server/src/modules/metrics/metrics.routes.ts:23` · security · confirmed

/api/v1/metrics and /api/v1/health (app.ts:194) only require requirePermission('system.manage') with the default minScope 'own'. The admin system role has ALL_PERMS('center'), so every center admin passes. centers.routes.ts already documents this pitfall and adds superadminOnly, but these two endpoints do not. In addition, Prometheus cannot scrape an endpoint that needs a 15-minute JWT, and under PM2 cluster each scrape hits a random worker's in-memory counters, which produces counter resets and meaningless rates.

- **Kịch bản lỗi:** The admin of a small center calls GET /api/v1/metrics and sees platform-wide request counts per route (including raw paths with other tenants' entity ids, see PERF-1), total DB size, table count and pool stats, plus the PostgreSQL version via /api/v1/health.
- **Đề xuất:** Gate both endpoints with superadminOnly, or serve metrics on an internal port or with a static scrape token. Aggregate counters per process with a worker label, or move them to a shared store.

#### `cross-cutting/PERF-1` — Metrics route label falls back to raw req.path: unbounded label cardinality and memory growth
`server/src/middleware/requestLogger.ts:17` · performance · confirmed

route = `${method} ${baseUrl}${req.route?.path || req.path}`. req.route is undefined for every request rejected before route matching (401 from requireAuth at the mount, 403 denyParents, 429 limiters, v1 404 handler). Each distinct raw path becomes a new key in the never-pruned requestCounts Map and a new Prometheus series, and the label value is not escaped.

- **Kịch bản lỗi:** Expired access tokens produce 401s on /api/v1/students/1234, /api/v1/invoices/5678 and similar paths during normal use, and scanners hitting random paths add more. The Map and the /metrics output grow without bound over the process lifetime.
- **Đề xuất:** Use `req.route?.path ? baseUrl+route.path : 'unmatched'` and escape label values. Optionally cap the Map size.

#### `cross-cutting/ARCH-1` — 'Superadmin falls back to the first center' is duplicated in five modules and silently writes into tenant #1
`server/src/utils/plans.ts:43` · architecture · confirmed

getDefaultCenter() (ORDER BY id LIMIT 1) is used as an implicit tenant by zalo.routes cidOf, rooms.routes effCid, classes.service resolveCenterId, payments.service resolveConfigCenterId and public resolvePublicCenter, each with its own copy of the fallback. Superadmin actions without an explicit center, and public requests whose Host does not match a subdomain (bare domain, www, IP), all land on whichever center has the lowest id.

- **Kịch bản lỗi:** The superadmin opens the payment-config page and saves VNPay keys, overwriting the real customer in center id=1. A visitor on the bare domain sees center #1's landing page, and their lead or trial registration is filed under center #1.
- **Đề xuất:** Make the center an explicit required parameter for superadmin writes (for example a ?center_id selector) and return 400 when it is missing. For public routes, return 404 for unknown hosts instead of defaulting. Keep a single resolver.

#### `cross-cutting/SEC-4` — Service worker caches authenticated /uploads files and serves them to later users; stale shell breaks after deploys
`client/public/sw.js:31` · frontend · confirmed

The fetch handler applies cache-first plus revalidate to every same-origin GET except /api, which includes /uploads/:filename. SecureFile fetches these with an Authorization header, but caches.match ignores request headers, so student submission files persist in CacheStorage across logout and are returned without any auth check. It also caches '/' (index.html). After a deploy, the old shell requests old hashed chunks that the server no longer has, and app.ts's SPA fallback answers /assets/<missing>.js with index.html and status 200. The browser rejects that on MIME type, and the SW caches that HTML under the JS URL.

- **Kịch bản lỗi:** On a shared computer at the center, a teacher views a student's homework photo and logs out. Another account on the same browser (or the same teacher after being removed from the class) gets the file straight from the SW cache. Separately, after each release, lazy routes fail with 'Failed to fetch dynamically imported module' until the user reloads twice.
- **Đề xuất:** In the SW, bypass /uploads (and any request with an Authorization header), and use network-first for navigations. Clear caches on logout. On the server, return 404 for missing /assets/* instead of the SPA fallback (fallthrough:false on the /assets static), and set Cache-Control: private, no-store on /uploads.

#### `cross-cutting/OPS-3` — PM2 config has no kill_timeout, so the 35s graceful shutdown is SIGKILLed after 1.6s
`ecosystem.config.js:19` · ops · confirmed

index.ts implements graceful shutdown (stop schedulers, waitForJobs up to 30s, drain HTTP, close pool, 35s force timer), but ecosystem.config.js does not set kill_timeout. PM2's default is 1600 ms before SIGKILL, and there is no wait_ready/listen_timeout either.

- **Kịch bản lỗi:** `pm2 reload educenter-pro` during a reminder run or a backup kills the worker mid-loop. Reminder rows stay in 'sending' state, a pg_dump .tmp file is orphaned, and in-flight requests are cut, so the documented shutdown guarantees never apply in the recommended deployment.
- **Đề xuất:** Add `kill_timeout: 40000` (greater than the 35s force timer). Consider `wait_ready: true` with process.send('ready') after listen.

#### `cross-cutting/OPS-4` — Uploaded files are never backed up; the upload dir is outside the documented and ignored path and shared with tests
`server/src/shared/upload.ts:15` · ops · confirmed

backupDatabase only pg_dumps. DEPLOYMENT/GO-LIVE offsite sync covers only ./backups. getUploadDir resolves to <repo-root>/uploads (from dist/shared, src/shared and test-dist/shared alike), while .gitignore lists only server/uploads/. uploads.integration.test.ts writes and deletes files in that same real directory.

- **Kịch bản lỗi:** A disk loss followed by a restore from backup brings the DB back with homework_attachments and submissions pointing to /uploads/hw_*.png files that no longer exist. In dev, `git add .` after testing uploads stages students' homework photos (PII). Running the test suite on a production host touches the live uploads directory.
- **Đề xuất:** Make UPLOAD_DIR configurable in env.ts. Include it in the backup and offsite sync documentation (or ship it to object storage). Add `uploads/` to .gitignore and point tests at a temporary directory.

#### `cross-cutting/OPS-5` — Nginx sample in DEPLOYMENT.md breaks file uploads (1MB default) and drops X-Forwarded-Proto
`docs/DEPLOYMENT.md:66` · ops · confirmed

The documented server block has no client_max_body_size, so nginx's 1MB default applies even though the app accepts uploads up to 10MB. It also does not forward X-Forwarded-Proto, so with TRUST_PROXY=true req.protocol stays 'http', and that feeds the VNPay returnUrl fallback when APP_BASE_URL is unset.

- **Kịch bản lỗi:** A parent uploads a 3MB phone photo as a homework submission, or a teacher attaches a PDF, and nginx answers 413 before the request reaches Express, so the UI shows a generic error. Separately, VNPay redirects back to http:// on an HTTPS site.
- **Đề xuất:** Add `client_max_body_size 12m;` and `proxy_set_header X-Forwarded-Proto $scheme;` (plus Host already present) to the sample. Make APP_BASE_URL required in production.

#### `cross-cutting/COR-2` — Global write limit of 60 per 15 minutes per account (halved per worker) blocks routine bulk grading; public limiter shares one bucket across routes
`server/src/middleware/rateLimit.ts:171` · correctness · confirmed

writeRateLimit applies to every POST/PUT/PATCH/DELETE under /api/v1, including per-student POST /homework/:id/scores, essay grading, enroll, and POST /auth/refresh, at 60 per 15 minutes divided by RATE_LIMIT_DIVISOR=2 per worker. Separately, publicRateLimit uses one module-level `buckets` Map keyed only by IP, so all six public routes plus /client-errors share a single counter: 20/min, so 10/min per worker. The landing page alone makes about 4 calls, and VN mobile CGNAT users share IPs.

- **Kịch bản lỗi:** A teacher grading two classes of 35 students within 15 minutes gets 429 'Bạn thao tác ghi quá nhanh' on about the 61st score. On the public landing page, a handful of visitors behind the same carrier NAT get 429s on page load and the lead form.
- **Đề xuất:** Exempt or separately limit authenticated staff writes (or raise the limit substantially). Namespace public buckets by route (key `${route}:${ip}`). Document the expected per-user throughput.

#### `server-core/SEC-3` — Idempotency middleware is check-then-act (not atomic) and keys are not scoped to user/path, so concurrent duplicate payments can go through
`server/src/middleware/idempotency.ts:39` · correctness · confirmed (ban đầu: high)

The middleware SELECTs the key. If the key is missing it runs the handler, and it INSERTs the key only when res.json fires after the business logic has committed. Two requests in flight with the same Idempotency-Key both miss the SELECT and both run. That is the exact double-submit/retry case the middleware exists for. It is used on POST /invoices, /invoices/:id/payments and /invoices/:id/refund. The lookup is `WHERE key = ?` only: user_id and path are stored but never compared. A key reused by a different user or on a different endpoint returns someone else's cached body. The middleware also runs a DELETE of expired keys on every keyed request.

- **Kịch bản lỗi:** A staff member records a partial payment of 500,000đ on a 1,000,000đ invoice. The first request is slow, and the client retries with the same per-intent key (Tuition.tsx:726) while the first is still running. Both pass the SELECT. recordPayment's FOR UPDATE lock serializes them, but the overpay guard allows both because the total is still ≤ amount. Two payments get recorded and the books show 1,000,000đ collected. Separately, a refund request that accidentally reuses a payment's key gets the payment's cached 201 response and the refund never runs.
- **Đề xuất:** Reserve the key atomically before running the handler: INSERT (key, user_id, path, status='processing') ON CONFLICT DO NOTHING RETURNING. On conflict, return 409 or the stored response once it is completed. Make the key unique per (user_id, key) and compare path/method. Move expired-key cleanup to the hourly cron (it is already there).

#### `server-core/SEC-5` — reqCenterId fails open: any non-superadmin with NULL center_id is treated as superadmin (global tenant access)
`server/src/middleware/auth.ts:183` · security · confirmed

reqCenterId returns null both for superadmin and for any user whose center_id is not a number. Every scope helper (`centerId !== null` filters in services, findByIdOr404, listAuditLogs, requireFeature, scopeOf) reads null as 'all centers'. users.center_id is nullable with no CHECK constraint (schema.ts:757-765). A realistic production path creates such users: a superadmin calls POST /teachers, which inserts center_id = cid = NULL (teachers.routes.ts:43-44), then POST /teachers/:id/account, which inserts a role 'teacher' user with teacher.center_id = NULL (teachers.routes.ts:159). backfillCenters only repairs this when SEED_DEMO=true.

- **Kịch bản lỗi:** The superadmin creates a teacher and login account without picking a center. That teacher's requests now carry centerId=null, so every center-filter branch is skipped. Any handler that does not also apply ownOnly returns data from all tenants. requireFeature lets them past plan gating, and they get superadmin-like scope with only teacher credentials.
- **Đề xuất:** Make reqCenterId fail closed: if role !== 'superadmin' and center_id is null, throw 403. Add a DB CHECK (role = 'superadmin' OR center_id IS NOT NULL). Reject creating center-owned rows when cid is null unless an explicit center_id is supplied.

#### `server-core/CORR-1` — Global write limiter (60 writes / 15 min / user) blocks normal per-student grading
`server/src/app.ts:130` · correctness · confirmed

Every POST/PUT/PATCH/DELETE under /api/v1 goes through writeRateLimit, which allows 60 per 15 min keyed by user. Grading is one request per student (POST /homework/:id/scores, homework.routes.ts:296) and one per student-question (POST /homework/:id/quiz/essay/grade, homework.routes.ts:366). Under PM2 with RATE_LIMIT_DIVISOR=2, each worker allows only 30.

- **Kịch bản lỗi:** A teacher grades essays for a class of 35 students with 2 essay questions, which is 70 POSTs. Partway through, the requests start returning 429 'Bạn thao tác ghi quá nhanh' and grading is blocked for up to 15 minutes. Taking attendance and recording payments in bulk hit the same limit.
- **Đề xuất:** Apply strict write limits only to costly or abuse-prone endpoints (auth, public, costly ops). Raise the general authenticated write quota by an order of magnitude, or add bulk grading endpoints.

#### `server-core/PERF-1` — Unbounded metrics map keyed by raw request path lets unauthenticated requests grow memory
`server/src/middleware/requestLogger.ts:17` · performance · confirmed

For every finished request, route = `${method} ${req.baseUrl}${req.route?.path || req.path}`. For unmatched requests req.route is undefined, so the raw path is used. trackRequest (metrics.routes.ts:15-19) adds a Map entry per unique key and never evicts. Paths outside /api (for example POST /<random>) have no rate limit at all. Labels are not escaped in the Prometheus output either (metrics.routes.ts:65).

- **Kịch bản lỗi:** A scanner or attacker sends POST /x-<uuid> in a loop. Each request adds a permanent Map entry, the heap grows until PM2's max_memory_restart (1G) recycles workers, and /api/v1/metrics responses grow to many MB.
- **Đề xuất:** Use a fixed label such as 'unmatched' when req.route is undefined (and the route pattern otherwise). Cap the map size and escape label values.

#### `server-core/PERF-2` — Synchronous bcrypt on unauthenticated login paths blocks the event loop
`server/src/modules/auth/auth.routes.ts:57` · performance · confirmed

Staff login uses bcrypt.compareSync (lines 56-58), and so do change-password (160), the reset hashSync (279), loginParent (parent.service.ts) and createCenterWithAdmin. Each compare at cost 10 blocks the worker for tens of milliseconds. Login is public, and the per-IP limit (10/min) does not stop distributed attempts. Parent changePassword already uses async bcrypt, so the code is inconsistent.

- **Kịch bản lỗi:** A burst of 50 concurrent login attempts from many IPs stalls each PM2 worker for several seconds, and every other request on that worker (dashboards, payments) waits behind it.
- **Đề xuất:** Use await bcrypt.compare / bcrypt.hash everywhere on request paths.

#### `server-core/SEC-7` — Hard-coded fallback JWT secret whenever NODE_ENV is not exactly 'production'
`server/src/config/env.ts:57` · security · confirmed

If JWT_SECRET is unset and NODE_ENV !== 'production' (staging, 'prod', unset under PM2 started without --env production, Docker without NODE_ENV), the server signs and verifies with the public constant 'educenter-dev-secret-change-me'. The only signal is a console.warn. The secret-length check is skipped in the same cases.

- **Kịch bản lỗi:** A staging or demo server with real data starts with NODE_ENV=staging. Anyone who has read the repo forges {role:'superadmin', center_id:null} and has full access. tv is optional, so a forged token without tv also skips the revocation check (auth.ts:66).
- **Đề xuất:** Require JWT_SECRET (≥32 chars) unless NODE_ENV is explicitly 'development' or 'test'. Never fall back silently.

#### `server-core/SEC-8` — Account-level login limiter allows targeted lockout; parent phone key is not normalized
`server/src/middleware/rateLimit.ts:254` · security · confirmed

Layer 2 counts every attempt, by anyone, against `login:<username|phone>` (20 per 15 min, 10 per worker under PM2). forgot-password shares the bucket. The key is the raw body string lowercased and trimmed, but loginParent normalizes phones ('0901…', '+84901…', '84901…' all map to the same account). Separately, loginParent (parent.service.ts:170-171) returns 'phone exists in several centers' before running bcrypt, which works as an unauthenticated enumeration oracle.

- **Kịch bản lỗi:** An attacker sends 20 wrong passwords for 'admin_centerX' from one IP every 15 minutes, and the real admin keeps getting 429 at login. For parents, the attacker cycles 3-4 phone formats and multiplies the per-account brute-force budget.
- **Đề xuất:** Normalize the account key with the same normalizePhone used by the service. Consider counting only failures and using progressive delay or CAPTCHA instead of hard blocking. Run the dummy bcrypt compare on the multi-center path too.

#### `server-core/TEST-1` — Server test runner never runs middleware tests and runs files in parallel against one shared schema (210/369 cancelled)
`server/package.json:35` · testing · confirmed

The node --test globs cover db/, modules/*/, services/ and shared/ but not test-dist/middleware/*.test.js. auth.test.ts, cookieAuth.test.ts and rateLimit.test.ts therefore never execute (none of their test names appear in the run output). There is also no --test-concurrency=1, while every file's setupTestDb drops and recreates the public schema in the same database. The measured run gave 369 tests, 157 pass, 2 fail and 210 cancelled, with errors such as 23505 duplicate pg_type 'centers', 'relation centers already exists' and a deadlock. The RBAC, privilege-escalation and forgot-password suites were among the cancelled. CI uses the same script.

- **Kịch bản lỗi:** A regression in requireAuth, requireSameOrigin or the rate limiters ships unnoticed because those tests never run. Security suites for RBAC and reset are cancelled, so CI gives no signal.
- **Đề xuất:** Add test-dist/middleware/*.test.js to the glob and run with --test-concurrency=1, or give each file its own schema or database. Add tests for SEC-1, SEC-2 and the idempotency race.

#### `server-core/SEC-9` — DELETE /api/v1/uploads/:filename deletes any uploaded file with no ownership or center check
`server/src/modules/uploads/uploads.routes.ts:60` · security · confirmed

Anyone with homework.create (every teacher, staff member and admin) can unlink any server-generated file by name: student submissions, other teachers' attachments, and other centers' files. The handler only validates the filename format and calls deleteUploadFileByUrl. Filenames are visible to everyone who can see the homework or submission.

- **Kịch bản lỗi:** A teacher opens a submission or another teacher's homework, copies the hw_<uuid>.pdf name and calls DELETE. The student's submission file is gone and the DB still points at a missing file.
- **Đề xuất:** Only delete files not referenced by homework_attachments or homework_submissions, and only those uploaded by this user. Record uploader and center at upload time and check them on delete.

#### `server-core/CORR-2` — Teacher-uploaded homework attachments can never be downloaded (GET /uploads authorizes submissions only)
`server/src/shared/uploadAccess.ts:27` · correctness · confirmed

checkUploadAccess looks the file up only in homework_submissions.file_url and throws 404 otherwise, before any role branch. Attachments uploaded via POST /api/v1/uploads (commit cb6ceec) are stored in homework_attachments.url as /uploads/hw_<uuid>.ext. The only route that serves /uploads/* (app.ts:100-121) therefore returns 404 for them, even for superadmin.

- **Kịch bản lỗi:** A teacher uploads a PDF worksheet and attaches it to homework. Anyone who opens the attachment link (teacher, student or parent) gets 404 'Không tìm thấy file'.
- **Đề xuất:** Extend checkUploadAccess to resolve homework_attachments (center check for staff, class/target membership for parents and teachers).

#### `server-data/DATA-4` — Non-superadmin users with users.center_id NULL get global (all-tenant) scope
`server/src/db/schema.ts:764` · security · plausible (ban đầu: high)

users.center_id and teachers.center_id are nullable for every role, and no CHECK ties NULL to role='superadmin'. reqCenterId() (middleware/auth.ts:187) returns null for any user whose center_id is not a number. Every service treats null as 'superadmin, no tenant filter'. When a superadmin creates a teacher, reqCenterId is null, so teachers.center_id is stored as NULL (teachers.routes.ts:43). Creating that teacher's login copies NULL into users.center_id (teachers.routes.ts:161).

- **Kịch bản lỗi:** A superadmin creates teacher 'GV X' and then 'Cấp tài khoản'. The new teacher user logs in and reqCenterId returns null, so list endpoints skip the `WHERE center_id = ?` clause. The teacher can read students, classes and attendance of every center their permissions cover.
- **Đề xuất:** Add CHECK ((role = 'superadmin') = (center_id IS NULL)) on users, after a backfill. Make reqCenterId throw 403 for a non-superadmin with no center. Require an explicit center_id when a superadmin creates tenant entities. In the longer term, make center_id NOT NULL on tenant tables.

#### `server-data/DATA-6` — Zalo token auto-refresh (H1) almost never runs: the proactive path exits early and the reactive path is unreachable
`server/src/services/zalo.ts:295` · correctness · confirmed

ensureZaloTokenFresh calls refreshZaloAccessToken when less than 24h remains. Inside the lock, refreshZaloAccessToken returns true without refreshing whenever more than 60s remains, so the proactive refresh is a no-op. The reactive retry at lines 533-540 checks r.data.error === -216, but sendZNS throws ZaloTokenError for -216/-220 instead of returning, so that branch is dead. The 're-read inside lock' also goes through getCenterSettings' 60s per-process cache, so a second PM2 worker can refresh with a refresh token that was already consumed.

- **Kịch bản lỗi:** An admin pastes an access token through the UI, which does not set zalo_token_expires_at. ensureZaloTokenFresh returns early, the token expires, and sendZNS throws ZaloTokenError. The run stops and an alert fires, but no refresh is ever attempted. Separately, zalo-refresh.test.ts:99 ('1h left -> refresh') would fail if the suite actually ran.
- **Đề xuất:** Pass a 'force' threshold into refreshZaloAccessToken that matches the caller's window. In sendTuitionReminder, catch ZaloTokenError, refresh, and retry once. Inside the lock, read settings bypassing the cache (invalidateCenterSettings first, or query directly).

#### `server-data/DATA-8` — Destructive DB tests run against whatever DATABASE_URL .env provides; backup.test drops every table in it
`server/src/db/backup.test.ts:63` · ops · confirmed (ban đầu: high)

10 of 24 DB test files do not set process.env.DATABASE_URL: backup, schema, consistency, upgrade, refund, leads.convert, refresh.service, leave-overlap, payroll.perf and authorization. They rely on the npm script exporting it. pg-compat calls dotenv.config() at import, and the uncommitted env.ts loads .env from three more paths, so a direct `node --test test-dist/db/backup.test.js` (or an IDE test runner) connects `db` to the primary DATABASE_URL. setupTestDb only targets TEST_URL. backup.test then runs DROP TABLE ... CASCADE on every public table through `db` and calls pg_restore --clean against process.env.DATABASE_URL. upgrade.test drops and recreates constraints and inserts junk rows in the same database.

- **Kịch bản lỗi:** A developer runs a single test file from the IDE with the default .env, where DATABASE_URL is the main educenter DB. backup.test wipes all tables of the main DB. If pg_restore fails (version mismatch, permissions), the data is gone apart from a dump left in os.tmpdir. If .env on a server points to production, this hits production.
- **Đề xuất:** In setupTestDb and in any test using `db`, assert that the connected current_database() ends with '_test' before running destructive SQL. Set DATABASE_URL = TEST_URL at the top of every DB test file, or in a shared --import preload. Never call dotenv from library modules such as pg-compat.

#### `server-data/DATA-10` — Global UNIQUE on tenant-scoped business keys (students.code, roles.code) causes cross-tenant collisions and reveals what other tenants use
`server/src/db/schema.ts:838` · architecture · confirmed

students.code is UNIQUE across the whole database (line 838), and so is roles.code (line 790). createStudent checks `SELECT 1 FROM students WHERE code = ?` with no center filter, and roles.routes maps any insert error to 'Mã vai trò đã tồn tại'.

- **Kịch bản lỗi:** Center A has HV001. Center B's admin creates student code HV001 and gets 409 'Mã học viên đã tồn tại', a working oracle for which codes other tenants use; every center's natural HV001.. numbering collides. Center A creates custom role 'receptionist', and center B can never create a role with that code.
- **Đề xuất:** Change to UNIQUE (center_id, code) for students (with a migration dropping students_code_key) and UNIQUE (COALESCE(center_id,0), code) for roles. Scope the existence checks by center_id.

#### `server-data/DATA-11` — initDatabase runs full DDL on every boot of every PM2 worker with no global lock: crashes on concurrent boot and table locks during rolling reload
`server/src/db/index.ts:14` · ops · confirmed

ecosystem.config.js runs 2 cluster workers, and each runs createSchema, createIndexes, createTriggers (DROP TRIGGER plus CREATE TRIGGER on about 45 tables), createHistoryTables (CREATE OR REPLACE FUNCTION, DROP/CREATE audit triggers) and seedAuthorization at the same time. Only individual migrations take an advisory lock. Concurrent CREATE TABLE or CREATE OR REPLACE FUNCTION fails with duplicate pg_type key or 'tuple concurrently updated', the same errors the test log shows. DROP TRIGGER takes an ACCESS EXCLUSIVE lock on each hot table on every boot.

- **Kịch bản lỗi:** First deploy with `pm2 start --env production` on a fresh DB: worker 2 crashes with 'duplicate key value violates unique constraint pg_type_typname_nsp_index' and PM2 restart-loops it. During `pm2 reload`, the restarting worker's DROP TRIGGER on students or classes waits behind a 25s report query on the live worker, and every other query on that table queues behind the lock, stalling the app for up to the 30s statement_timeout.
- **Đề xuất:** Wrap the whole initDatabase in pg_advisory_lock('educenter-init') on a dedicated client. Make triggers idempotent without DROP, for example check pg_trigger first or use CREATE OR REPLACE TRIGGER on PG14+. Run DDL only when the schema version changed.

#### `server-data/DATA-12` — Every query in an authenticated request runs as its own BEGIN/set_config/query/COMMIT on a dedicated connection
`server/src/db/pg-compat.ts:308` · performance · confirmed

poolQuery, when requestActor is set, checks out a client and runs 4 statements per logical query, reads included, so that audit triggers can see app.user_id. Only writes to payments and invoices need the actor.

- **Kịch bản lỗi:** A dashboard or list request issuing about 10 SELECTs makes about 40 round trips plus 10 pool checkouts. With a managed PG at about 1 ms RTT that adds about 30 ms per request, and it multiplies connection churn under load with a 20-connection pool per worker.
- **Đề xuất:** Only take the transactional path for non-SELECT statements, or only when the SQL touches payments or invoices. Alternatively, set the actor once per request on a request-scoped client.

#### `server-data/DATA-13` — VNPay reconcile marks a transaction 'failed' on a transient querydr error, after which a late IPN can never credit the payment
`server/src/jobs/vnpayReconcile.ts:69` · correctness · confirmed

When queryVnpayTransaction returns !ok (network timeout, VNPay maintenance), reconcileOne immediately runs markFailed and alerts. confirmVnpayTxn rejects any transaction whose status is not 'pending' (payments.service.ts:65/105), so VNPay's own IPN retries for that ref are refused with invalid_status.

- **Kịch bản lỗi:** A parent pays successfully at minute 5. The IPN is lost, and at minute 60 querydr times out. The txn becomes 'failed'. VNPay's IPN retry arrives and gets invalid_status. The parent has been charged but the invoice stays unpaid, and an operator has to find the alert and reconcile by hand.
- **Đề xuất:** On querydr errors, leave the txn pending and increment an attempts counter, retrying on the next 15-minute cycle. Mark it failed only on a definitive VNPay status or after N attempts or a long age.

#### `server-data/DATA-14` — Idempotency keys are global (not scoped by user/path) and saved only after the handler finishes, so concurrent duplicates both execute
`server/src/middleware/idempotency.ts:39` · correctness · confirmed

idempotency_keys has PK(key) only (schema.ts:1538). The middleware does SELECT, then next(), and INSERTs the key from the res.json wrapper. Two requests with the same key that arrive together both miss the SELECT. Lookup ignores user_id and path, so a replayed key returns another user's cached response body. This applies even after DATA-1 is fixed.

- **Kịch bản lỗi:** A double-click or a client retry fires two POST /invoices/:id/payments with the same per-intent key a few milliseconds apart. Both pass the check and both insert a payment.
- **Đề xuất:** INSERT the key with status 'in_progress' (ON CONFLICT DO NOTHING) before calling next(); if no row was inserted, return 409 or the stored response. Make the key unique per (user_id, key) and verify method and path on a hit.

#### `server-data/DATA-15` — The SQLite to PostgreSQL migration script copies UTC timestamps into columns that now hold Vietnam local time, shifting all migrated rows by 7 hours
`scripts/migrate-sqlite-to-pg.ts:147` · correctness · confirmed

The SQLite schema used DEFAULT (datetime('now')), which is UTC (verified in 7bdd039^). The PG schema stores TEXT 'YYYY-MM-DD HH24:MI:SS' in Asia/Ho_Chi_Minh. The script inserts the values unchanged.

- **Kịch bản lỗi:** A payment made at 2026-09-01 05:00 VN was stored in SQLite as 2026-08-31 22:00. After migration, monthly revenue counts it in August. 'Hôm nay' dashboards, the 3-day reminder suppression and the audit timeline are all off by 7 hours for legacy data.
- **Đề xuất:** Convert timestamp columns during migration: `(value::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')` formatted back to text, for created_at, updated_at, paid_at, completed_at and similar. Leave date-only columns unchanged. Also fix TABLE_DOCS, which still says '(UTC)'.

#### `server-domain/COR-2` — Lazy session generation brings back deleted sessions and keeps sessions from the old schedule
`server/src/modules/sessions/sessions.service.ts:100` · correctness · confirmed

listClassSessions calls generateSessionsForClass on every GET. That function (db/helpers.ts:148-175) inserts every scheduled weekday in [start_date or today-90, end_date or today+60] with ON CONFLICT DO NOTHING. This causes three problems: (a) deleteSession cannot remove a scheduled date, because the next GET inserts it again; (b) updateClass changing the schedule never removes sessions already generated on the old weekdays, so old and new days both show up; (c) sessions only exist once someone opens the list, so /teacher/today, the dashboard's todaySessions and the parent's upcomingSessions are empty for classes nobody has opened recently, and for open-ended classes beyond today+60 at the last GET.

- **Kịch bản lỗi:** Staff delete the 02/09 (holiday) session and it reappears on the next page load. A class moves from Mon/Wed to Tue/Thu, and parents now see 4 upcoming sessions a week. A newly created class shows no sessions on the teacher portal's 'today' tab.
- **Đề xuất:** Generate sessions when a class is created or its schedule changes, not on read. Delete future sessions without attendance when the schedule changes, and soft-cancel deleted sessions (status='cancelled') so regeneration skips them.

#### `server-domain/SEC-3` — Teachers can read the check-in code and mark sessions with no date limit, inflating their own payroll
`server/src/modules/sessions/sessions.service.ts:103` · security · confirmed

GET /classes/:id/sessions (`SELECT s.*`) and GET /sessions/:id/attendance (`SELECT * FROM sessions`, line 153) return checkin_code and checkin_date to teachers, who hold sessions.view and attendance.view at scope 'own'. A teacher can read the code remotely and POST /teacher/checkin (teacher.service.ts:76-89), which makes the on-site code control useless. saveAttendance also has no date bounds. Payroll counts any session that has a teacher_checkin or any attendance row (payroll.service.ts:41-42).

- **Kịch bản lỗi:** A teacher marks attendance on every auto-generated session of the month, including cancelled or holiday dates and future sessions, or fetches today's code from home and checks in. Their payroll sessions count goes up with no staff involvement.
- **Đề xuất:** Leave checkin_code out of teacher-facing responses (select explicit columns). Reject attendance for future dates and for dates older than N days for 'own' scope. Consider counting payroll only from teacher_checkins or attendance that staff have approved.

#### `server-domain/SEC-4` — Teachers without invoices.view see student invoices and payments
`server/src/modules/students/students.service.ts:101` · security · confirmed

getStudentDetail always returns every invoice with amount, status, note and confirmed paid sum. The teacher role has students.view 'own' but not invoices.view, so teachers get financial data the RBAC matrix withholds from them. The 'own' filter (lines 48-52 and 86-87) also ignores enrollment status, so teachers keep seeing students who have left their classes.

- **Kịch bản lỗi:** A teacher opens GET /api/v1/students/:id for a student in their class and gets the family's full invoice and payment history and debt.
- **Đề xuất:** Include invoices only when the caller has invoices.view. Filter the 'own' scope on e.status='active'.

#### `server-domain/COR-3` — Trial conversion attaches referrals by phone across centers and referrers
`server/src/modules/trials/trials.service.ts:128` · correctness · confirmed

convertTrial runs `UPDATE referrals SET referred_student_id=? WHERE referred_phone=? AND status='pending' AND referred_student_id IS NULL`. It does not check the referrer's center and ignores trial.referral_code. The reward step (services/referrals.ts:96) then pays the lowest-id pending referral, which may belong to another tenant's parent or to a referrer other than the code the family actually used.

- **Kịch bản lỗi:** Parent P1 at center A referred phone 0901xxxxxx months ago, and that family never enrolled at A. The family then signs up for a trial at center B with P2's code. On conversion both referrals get attached; when the first invoice is paid, P1 receives a referral credit recorded with center_id = B and P2 gets nothing.
- **Đề xuất:** Resolve the referrer from trial.referral_code within trial.center_id and attach only that referral row (JOIN parents p ON p.id = referrer_parent_id AND p.center_id = trial.center_id).

#### `server-domain/COR-4` — Trial and lead conversion enroll students without the class capacity check
`server/src/modules/trials/trials.service.ts:115` · correctness · confirmed

convertTrial (and convertLeadToStudent, leads.service.ts:135-139) inserts into enrollments directly. That skips the max_students check, the FOR UPDATE lock in enrollStudent (classes.service.ts:437-447) and any class-status check, and no DB constraint enforces capacity either.

- **Kịch bản lỗi:** A class is full at 30/30. Staff convert three trials that chose that class, and it ends up at 33 active students. updateClass then refuses any max_students edit below 33.
- **Đề xuất:** Reuse the capacity-checked enrollment logic inside the conversion transaction (lock the class row, count, reject when full or inactive).

#### `server-domain/SEC-5` — Public tenant resolution falls back to the first center, so leads land in the wrong tenant
`server/src/modules/public/public.routes.ts:130` · security · confirmed

resolvePublicCenter (utils/plans.ts:69-80) returns getDefaultCenter() (lowest id) whenever the Host subdomain is unknown: a mistyped or renamed subdomain, the apex domain (e.g. 'educenter.vn' → sub 'educenter'), or a raw IP. POST /public/leads and /public/trials then store a prospect's name, phone and note under center #1. The POST endpoints also skip the 'landing' feature gate that the GET endpoints apply.

- **Kịch bản lỗi:** Center 7 renames its subdomain while an old landing link is still live. Every lead submitted through the old link is written to center 1, whose staff see another tenant's prospects, and center 7 never receives them.
- **Đề xuất:** Return 404 for an unknown subdomain in multi-tenant mode and use the default center only in single-tenant or dev mode. Apply hasFeature(center,'landing') to the POST endpoints as well.

#### `server-domain/SEC-6` — Teachers created by superadmin get center_id NULL, and their accounts act as global users
`server/src/modules/teachers/teachers.routes.ts:44` · security · confirmed

POST /teachers stores `center_id = reqCenterId(req)`, which is NULL for superadmin; rooms and classes use a default-center fallback, teachers do not. POST /teachers/:id/account (line 161) copies that NULL into users.center_id with role 'teacher'. reqCenterId (middleware/auth.ts:183-188) returns null, meaning unscoped, for any user whose center_id is not a number, so that teacher account is treated like a superadmin for center scoping. The teacher also cannot be assigned to any class, because resolveTeacherId rejects the mismatch.

- **Kịch bản lỗi:** A superadmin creates teacher T and an account for T. T logs in, and GET /dashboard (reports.view 'own') returns totalStudents, totalTeachers, activeClasses and todaySessions (class and teacher names) aggregated across all tenants.
- **Đề xuất:** Require an explicit center_id for superadmin-created teachers and students, add a DB CHECK (role='superadmin' OR center_id IS NOT NULL) on users, and make reqCenterId fail closed (throw) for non-superadmins without a center.

#### `server-domain/COR-5` — Deleting a class or teacher erases attendance and payroll history
`server/src/modules/classes/classes.service.ts:406` · correctness · confirmed

deleteClass is blocked only by homework. Otherwise it deletes every session and attendance row, and teacher_checkins go too via ON DELETE CASCADE from sessions. grades and invoices lose class_id. Teacher DELETE (teachers.routes.ts:103-108) likewise deletes teacher_checkins when no salary_rules row exists. Payroll is recalculated from these tables at read time, so past months change.

- **Kịch bản lỗi:** An admin cleans up a finished class that had 6 months of attendance. Teacher payroll for those months drops to 0 for that class, students' attendance rates in the parent overview reset, and only an audit summary line remains.
- **Đề xuất:** Block deletion when attendance or check-ins exist (soft-deactivate with status='inactive' instead), as is already done for homework.

#### `server-domain/COR-6` — Room and teacher conflict detection has false positives and can be bypassed
`server/src/modules/classes/classes.service.ts:139` · correctness · confirmed

findRoomConflict and findTeacherConflict compare only weekday and time against every class with status='active'. They ignore start_date/end_date, so a class that ended but was never deactivated blocks the room permanently, and non-overlapping terms clash. parseSchedule (line 68) accepts inverted or invalid times ('18:00'-'08:00', '99:99'), and those never match the overlap test. The check-then-insert also runs without a lock, so two concurrent creates can double-book a room.

- **Kịch bản lỗi:** The Spring class (ended in March, still 'active') stops the Summer class from using Room 1 on Mon 18:00. Separately, an entry typed as 18:00-08:00 is saved and overlaps a real 18:00-19:30 class in the same room without being detected.
- **Đề xuất:** Validate HH:MM range (00-23:00-59) and start < end. Include the date-range overlap in the conflict query. Serialize with an advisory lock per room/teacher, or an exclusion constraint if schedules are normalized into rows.

#### `server-domain/PERF-1` — Session list GET writes one INSERT per scheduled day on every request
`server/src/db/helpers.ts:170` · performance · confirmed

generateSessionsForClass loops day by day across the whole class range and issues a separate INSERT round trip for each scheduled weekday, inside a transaction, on every GET /classes/:id/sessions (sessions.service.ts:100). Combined with pg-compat's per-statement overhead, a page view becomes hundreds of DB round trips plus a write transaction.

- **Kịch bản lỗi:** A 1-year class meeting 3 times a week means about 156 INSERTs each time a teacher or staff member opens the sessions tab. Ten teachers refreshing during attendance time give about 1.5k write statements and hold pool connections.
- **Đề xuất:** Generate on class create or update only, or use a single INSERT ... SELECT FROM generate_series(...) WHERE extract(isodow) IN (...) ON CONFLICT DO NOTHING.

#### `server-domain/TEST-1` — Server DB test suite races on one database; scope tests did not effectively run
`server/package.json:35` · testing · confirmed

`node --test` runs test files in parallel subprocesses, but each file's setupTestDb() drops and recreates the public schema in the same database. The measured run fails with 'Key (typname)=(centers) already exists': 369 tests, 157 pass, 2 fail, 210 cancelled. The DB-backed tests in this scope (parent.security, students.scope, trials.convert, leads.convert, teachers.detail, classes.search, leave-overlap) are effectively not exercised, and CI (4 vCPU) hits the same race. Separately, there are no tests for teacher 'own' scoping in students/sessions, the teacher portal, public routes, rooms, reviews, staff leave approval, or HTTP-level permission wiring. classes.enroll-race.test.ts uses a mock DB, so it cannot verify the FOR UPDATE lock.

- **Kịch bản lỗi:** A regression that drops `await getLinkedStudent` or a center filter ships, because the regression tests written for it are cancelled before they run.
- **Đề xuất:** Add `--test-concurrency=1`, or give each file its own schema/database. Add supertest-level tests for the role matrix (teacher, staff, parent) on students, sessions and dashboard.

#### `server-homework/HW-4` — Quiz review reveals correct answers after the first attempt; unlimited retakes and highest-score-kept make 100% trivial
`server/src/modules/homework/quiz.service.ts:738` · correctness · confirmed (ban đầu: high)

getAttemptReview returns `is_correct` for every option, reachable by the parent right after submitting (parent.routes.ts:396). submitQuiz allows unlimited attempts and keeps the highest score via GREATEST (lines 338-347). There is no attempt limit and no 'show answers after close_date' gate.

- **Kịch bản lỗi:** A student submits random answers, opens the review and sees every correct option, then resubmits for full marks. homework_scores keeps 100%, so auto-graded quiz scores carry no information.
- **Đề xuất:** Hide is_correct (show only right/wrong per question) until close_date or due_date has passed. Or add a per-quiz max_attempts or 'keep latest' policy. At minimum, never reveal answers while retakes are still allowed.

#### `server-homework/HW-6` — DELETE /api/v1/uploads/:filename deletes any server file, including attached files and student submissions
`server/src/modules/uploads/uploads.routes.ts:65` · security · confirmed

The handler comment says it is for files 'chưa gắn vào bài nào', but it only validates the filename pattern before unlinking. It does not check that the file is unattached or belongs to the caller's center, and uploads are not recorded with uploader or center. validateAttachmentInputs (homework.service.ts:643-647) likewise accepts any /uploads/<name>, so attaching a foreign URL and then removing it (or deleting the homework) also unlinks it.

- **Kịch bản lỗi:** An own-scope teacher, or any user with homework.create, who learns a filename (from submissions lists, audit meta, or a shared URL) calls DELETE /api/v1/uploads/hw_<uuid>.jpg. A student's submission or another teacher's or center's attachment is permanently removed while its DB row stays.
- **Đề xuất:** Refuse the delete if any homework_attachments or homework_submissions row references the URL. Better: store uploads in a table (uploader, center_id, attached flag) and allow deleting or attaching only your own center's unattached uploads.

#### `server-homework/HW-8` — Switching a quiz's rubric keeps old criterion scores in the essay total
`server/src/modules/homework/quiz.service.ts:648` · correctness · confirmed

essay_score = SUM(score) over all quiz_essay_scores rows for the student, with no filter on the current rubric's criteria. updateHomework allows changing rubric_id at any time. Deleting the now-unused old rubric cascades away its scores but leaves homework_scores stale.

- **Kịch bản lỗi:** A teacher grades essays with rubric R1 (8 points), switches the quiz to R2 and regrades (7 points). The total becomes auto + 15, which is either inflated or rejected as exceeding max_score.
- **Đề xuất:** Filter the SUM to the criterion_ids of the current rubric, or block rubric changes (or clear quiz_essay_scores) once essay grading exists.

#### `server-homework/HW-9` — Multi-class assignment applies the same target-student list to every class
`server/src/modules/homework/homework.routes.ts:162` · correctness · confirmed

filterValidTargets returns students active in any of the selected classes, and createHomeworkBatch inserts that full list as targets for each class's homework (homework.service.ts:357). The client merges students across all selected classes (HomeworkFormModal.tsx:232-246).

- **Kịch bản lỗi:** A teacher selects classes A and B and picks 2 students from A only. Class B's homework is targeted at 2 students not enrolled in B, so it is published but invisible to every B student. student_count and completion-rate analytics are also wrong for both classes.
- **Đề xuất:** For each class, insert only the targets enrolled in that class. Skip classes with no remaining targets, or reject the request.

#### `server-homework/HW-10` — Any center can delete a shared global rubric
`server/src/modules/homework/rubric.service.ts:91` · security · confirmed

deleteRubric throws only when r.center_id is non-null and differs, so global rubrics (center_id NULL, visible to all tenants via listRubrics) can be deleted by any user with homework.delete. The question bank fixed exactly this (P1-10, questionBank.service.ts:263), but rubrics were not updated.

- **Kịch bản lỗi:** A teacher in center A deletes the superadmin's global rubric 'IELTS Writing' (not yet linked to homework). It disappears for every other center.
- **Đề xuất:** Mirror P1-10: `if (r.center_id === null && centerId !== null) throw notFound`.

#### `server-homework/HW-11` — Vietnamese upload filenames are corrupted (multer decodes filenames as latin1)
`server/src/shared/upload.ts:120` · correctness · confirmed

multer 2.4 defaults defParamCharset to 'latin1'. Browsers send UTF-8 filenames without filename*, so originalname is mojibake. It is stored as homework_submissions.file_name (parent.routes.ts:427), returned as the attachment `name` (uploads.routes.ts:45) and written to audit logs. The longer garbled name can also exceed the 200-character limit in validateAttachmentInputs, so saving fails after a successful upload.

- **Kịch bản lỗi:** A parent uploads 'Bài tập tuần 3.jpg'. The teacher sees 'BÃ i táº­p tuáº§n 3.jpg' in the submissions list.
- **Đề xuất:** Pass `defParamCharset: 'utf8'` to multer, or normalise with Buffer.from(originalname, 'latin1').toString('utf8').

#### `server-homework/HW-12` — Quiz creation is not atomic: quiz is committed as published before its questions are saved
`server/src/modules/homework/homework.routes.ts:180` · correctness · confirmed

createHomeworkBatch commits the homework rows (status may be 'published') in its own transaction. saveQuizQuestions then runs separately per class. During that window, or permanently if a later save fails (DB error, or a concurrent attempt making it throw), a published 0-question quiz exists. P0-3 was meant to rule this out.

- **Kịch bản lỗi:** A quiz assigned to 3 classes: saving questions for class 2 fails on a transient DB error. Classes 2 and 3 are left with published quizzes that have no questions and max_score set from the payload, and the request returns 500.
- **Đề xuất:** Insert the questions inside the same db.transaction as insertHomeworkTx (reuse the insert loop from reuseHomework).

#### `server-homework/HW-13` — listHomework fan-out join aggregates completions × targets × enrollments × questions for every homework before LIMIT
`server/src/modules/homework/homework.service.ts:162` · performance · confirmed

The P1-4 rewrite LEFT JOINs four child tables and uses COUNT(DISTINCT) to undo the multiplication. Rows per homework = completions × targets × enrollments × questions, and GROUP BY/ORDER BY run over all homework in scope before LIMIT 20.

- **Kịch bản lỗi:** A center with 300 quizzes, 30 students per class (all completed) and 40 questions each: about 30×30×40 = 36k intermediate rows per homework, roughly 10M rows sorted and deduplicated per page load of the homework list.
- **Đề xuất:** Use per-table pre-aggregated subqueries (LEFT JOIN (SELECT homework_id, COUNT(*) ... GROUP BY homework_id)). Or page homework ids first, then aggregate only those 20.

#### `server-homework/HW-15` — Question bank list has an N+1 query (one options query per question, up to 100)
`server/src/modules/homework/questionBank.service.ts:90` · performance · confirmed

listBankQuestions runs a separate question_bank_options query per row via Promise.all. quiz.service already has getOptionsBatch for this pattern.

- **Kịch bản lỗi:** GET /homework/bank/questions?limit=100 runs 102 queries and briefly takes up to 100 pool connections, starving other requests.
- **Đề xuất:** Load options with one `WHERE question_id IN (...)` query and group them in memory.

#### `server-homework/TEST-1` — Server test script runs test files in parallel against one shared DB; all DB-backed homework, uploads and grades suites were cancelled
`server/package.json:35` · testing · confirmed

`node --test` runs files concurrently by default. Each file's setupTestDb runs createSchema on the same database, which races (duplicate key pg_type_typname_nsp_index). In the measured run: 369 tests, 157 pass, 2 fail, 210 cancelled. Every DB-backed suite in this scope (homework.integration, uploads.integration, homework.scope) was cancelled; only mock-based tests (quiz.essay, quiz.batch, quiz.lock, quiz.n1) ran. CI uses the same `npm test -w server`. There are also no HTTP-level tests of homework route tenant scoping and none for checkUploadAccess, which is why HW-1 and HW-2 went unnoticed.

- **Kịch bản lỗi:** A regression in cross-tenant homework scoping or grading ships because the integration suite never executes, or fails nondeterministically, in CI.
- **Đề xuất:** Add `--test-concurrency=1` (or one schema/DB per worker). Add supertest-style route tests for 404 across centers, own-scope teachers, PUT keeping status, and GET of attachments and submissions.

#### `server-money/IDEM-1` — Idempotency middleware has no in-flight reservation; key not bound to user/path/body
`server/src/middleware/idempotency.ts:39` · correctness · confirmed

The middleware does SELECT; on a miss it runs the handler and only INSERTs the key after res.json, fire-and-forget. Two requests with the same key that overlap both miss and both execute. On a hit it replays the cached body without checking user_id, method, path or body, so the same key on another invoice or by another user returns a stale or foreign response. It also runs a full DELETE of expired keys on every money POST, which duplicates the cron in index.ts.

- **Kịch bản lỗi:** A staff member records 500,000đ on a 2,000,000đ invoice. The request stalls at a proxy and the client or proxy retries with the same Idempotency-Key while the first is still running. Both pass the SELECT, both pass the overpay guard (they serialize on FOR UPDATE, but 1,000,000 ≤ 2,000,000), and two payments are recorded, so debt is understated by 500,000đ. The same race applies to POST /:id/refund (double refund).
- **Đề xuất:** INSERT the key first (status 'processing') with ON CONFLICT DO NOTHING and proceed only if the row was inserted. Otherwise return 409 or the stored result. Store a body hash plus user_id/path and reject a mismatch with 422. Drop the per-request DELETE.

#### `server-money/PAY-4` — VNPay querydr signs/verifies with the wrong checksum format; reconciliation cannot work
`server/src/services/vnpay.ts:161` · correctness · confirmed

VNPay's merchant_webapi querydr uses a pipe-delimited checksum in a fixed field order (RequestId|Version|Command|TmnCode|TxnRef|TransactionDate|CreateDate|IpAddr|OrderInfo, and a fixed response order), not the sorted key=value string. Both the request hash and the response verification are wrong, so every querydr fails with ok:false. reconcileOne then marks the txn failed and sends an alert. Also, for txns reused by createVnpayPayment, the URL is rebuilt with a new vnp_CreateDate, while querydr sends vnp_TransactionDate = payment_txns.created_at, so VNPay would not find the transaction even with a correct checksum. The code comment admits it was not verified against the sandbox.

- **Kịch bản lỗi:** An IPN is lost because of a network blip. 60 minutes later the cron calls querydr, which fails signature checks. The txn is marked 'failed' even though the parent paid, and every stuck txn produces an alert and needs manual handling.
- **Đề xuất:** Implement VNPay's documented pipe-delimited checksum for querydr (request and response). Persist the vnp_CreateDate actually sent (do not regenerate it for reused txns) and pass it as vnp_TransactionDate.

#### `server-money/PAY-5` — Refund ignores credit-funded portion and referral rewards are never clawed back
`server/src/modules/payments/payments.service.ts:446` · correctness · confirmed

netPaid sums every confirmed payment, including method='credit' rows (promotional referral credits). Refunding up to netPaid therefore pays out credit value as cash, and the credits' used_amount is not restored. Referral rewards granted by afterInvoicePaid are never revoked when the qualifying invoice is fully refunded.

- **Kịch bản lỗi:** An invoice of 1,000,000đ is paid with 200,000đ of referral credit plus 800,000đ cash. Admin refunds 1,000,000đ, so the parent receives 200,000đ more cash than they paid. Or: a self-referral is paid in full, both parents get 200k credits, and the invoice is refunded in full; the credits remain usable.
- **Đề xuất:** Cap cash refunds at the non-credit paid amount and restore credits for the credit portion. When the first paid invoice is refunded and drops below paid, reverse or flag the referral reward.

#### `server-money/PAYROLL-1` — Payroll attributes sessions to the class's current teacher and applies the current rate retroactively
`server/src/modules/payroll/payroll.service.ts:70` · correctness · confirmed

calcPayrollBulk and calcPayroll join sessions through classes.teacher_id, which is the class's teacher now, and ignore teacher_checkins.teacher_id, the teacher who actually checked in. Payroll is computed on the fly with today's salary_rules.per_session_amount, and there is no rate history or monthly snapshot.

- **Kịch bản lỗi:** Teacher A teaches class C during January. On Feb 1 the class is reassigned to teacher B. The January payroll viewed in February shows A with 0 sessions and B with all of A's sessions. Raising A's rate in March also changes the January and February figures already paid.
- **Đề xuất:** Attribute by teacher_checkins.teacher_id (or a sessions.teacher_id set at teach time). Snapshot the rate per session, or close payroll per month into a persisted table.

#### `server-money/PAYROLL-2` — Teacher can inflate own payroll by taking attendance on future sessions
`server/src/modules/payroll/payroll.service.ts:73` · security · confirmed

A session counts toward pay if any attendance row exists (any status, including all 'absent'). sessions.service saveAttendance (teacher has attendance.take 'own') has no guard against session dates in the future. Sessions are pre-generated up to 60 days ahead.

- **Kịch bản lỗi:** On the 5th of the month a teacher opens every remaining session of the month for their classes and saves attendance (even all absent). GET /payroll counts all of them, and the month's pay roughly doubles before any of those sessions happen.
- **Đề xuất:** Reject attendance and check-ins for sessions dated after today (VN time) in saveAttendance. In payroll, count only sessions with date ≤ today and with at least one present/late record or a teacher check-in.

#### `server-money/INV-1` — updateInvoice amount change not transactional: race with concurrent payment yields an overpaid invoice
`server/src/modules/invoices/invoices.service.ts:236` · correctness · confirmed

updateInvoice reads the current amount and the confirmed-payment count without a transaction or lock, then UPDATEs the amount and calls recalcInvoiceStatus outside any transaction. recordPayment, approve and IPN lock the invoice row, but updateInvoice does not, so the 'cannot change amount after a confirmed payment' guard is TOCTOU.

- **Kịch bản lỗi:** Staff A edits the amount from 2,000,000 to 1,000,000 while staff B records 1,500,000. A reads confirmed=0, B commits 1,500,000 (passes, since 2,000,000 is the old amount), and A writes amount=1,000,000. The invoice now has paid 1,500,000 > amount 1,000,000, and recalc marks it paid with a 500,000 overpayment no guard caught.
- **Đề xuất:** Wrap updateInvoice in db.transaction with `SELECT ... FOR UPDATE` on the invoice, check confirmed payments inside, and compute the status with tx-scoped queries, as recordPayment does.

#### `server-money/INV-2` — createInvoice accepts class_id from another center (cross-tenant class-name disclosure)
`server/src/modules/invoices/invoices.service.ts:209` · security · confirmed

student_id is validated against the caller's center, but class_id is inserted unchecked. listInvoices, getInvoiceDetail, students.service and parent.service all LEFT JOIN classes on i.class_id and return c.name.

- **Kịch bản lỗi:** A staff member of center A (invoices.create) POSTs /invoices with class_id = 1..N on their own student, then GET /invoices shows class_name for every class id across all tenants.
- **Đề xuất:** Verify `SELECT 1 FROM classes WHERE id=? AND center_id=?` (student.center_id) before insert, and 404 otherwise.

#### `server-money/SCOPE-1` — reqCenterId fails open: a non-superadmin user with NULL center_id gets global (all-tenant) scope
`server/src/middleware/auth.ts:186` · security · plausible

reqCenterId returns null, which every money service treats as 'all centers', whenever user.center_id is not a number, regardless of role. users.center_id is nullable with no CHECK tying non-superadmin roles to a center, and login does not reject such users. Teacher accounts copy teacher.center_id, which can be NULL for legacy teachers. This sits outside the money modules but decides tenant scoping for every query in them.

- **Kịch bản lỗi:** A legacy admin or staff row with center_id NULL logs in. listInvoices, getDebtReport, approvePendingPayment, refundInvoice and calcPayrollBulk all run unscoped, so that user can view and refund invoices and approve payments of every center.
- **Đề xuất:** Return null only for role==='superadmin'. For any other role with no center, throw 403. Add CHECK (role='superadmin' OR center_id IS NOT NULL) on users.

#### `server-money/TEST-1` — Server test suite runs files in parallel against one shared public schema; money tests are cancelled
`server/package.json:35` · testing · confirmed

`node --test` runs test files concurrently by default. Each file calls setupTestDb → createSchema on the same database/public schema, which races ('duplicate key ... pg_type_typname_nsp_index', Key (centers, 2200)). In the measured run: 369 tests, 157 pass, 2 fail, 210 cancelled. That includes the invoices.integration, payments.idempotency approve-race, refundInvoice and consistency suites, so most money-path coverage did not actually run.

- **Kịch bản lỗi:** A regression in recordPayment, approve or refund merges unnoticed because those suites are cancelled in setup, not failed. Results vary with CPU count (CI runner versus a laptop).
- **Đề xuất:** Add `--test-concurrency=1`, or give each test file its own schema/database (for example, search_path set to a per-file schema).


### LOW (86)

#### `client-admin/ADM-12` — Temporary password can be lost after a reset (modal unmounted during reload)
`client/src/features/people/ResetRequests.tsx:71` · correctness · confirmed (ban đầu: medium)

process() sets tempPassword and immediately calls load(). During loading, the early return renders only the skeleton section, so the tempPassword Modal unmounts. If the reload fails, `if (error) return null` hides the whole section, so the modal never appears. By then the server has already changed the password, revoked sessions and marked the request processed.

#### `client-admin/ADM-15` — Zalo reminder type is chosen with a UTC date, so overdue invoices get the 'upcoming' template overnight
`client/src/features/tuition/Tuition.tsx:22` · correctness · unverified-low

remindKind uses `new Date().toISOString().slice(0,10)` (UTC). The codebase already has `todayVN()` for exactly this.

#### `client-admin/ADM-16` — Modal re-runs its focus effect whenever the parent re-renders (onClose is an inline arrow)
`client/src/shared/components/Modal.tsx:90` · frontend · unverified-low

Modal's main effect depends on [onClose], and almost every caller in scope passes `onClose={() => setX(null)}`. Each parent render runs cleanup, which restores focus to the opener, and then the effect again, which focuses the first focusable element (the close X). The team fixed this only for Homework (commit 5d820ab).

#### `client-admin/ADM-17` — Teacher account modal lets the browser autofill the admin's own saved login
`client/src/features/people/Teachers.tsx:221` · security · unverified-low

The username and password inputs have no autoComplete hints, so password managers treat them as a login form.

#### `client-admin/ADM-18` — Duplicated money logic and types are already causing divergence (the NaN receipt bug)
`client/src/features/tuition/tuition.api.ts:6` · architecture · unverified-low

InvoiceItem, DebtRow, RemindResult and PendingPayment are defined both here and in shared/types.ts, with conflicting shapes (phantom `discount`, required vs optional `paid`). `remainingOf()` is exported from InvoiceDetail, but Tuition.tsx recomputes `amount - paid` at lines 227, 373, 498 and 720, and ReceiptModal has its own broken formula. Other duplicates: StudentDetail bypasses studentsApi (http.get/post/del at lines 33, 229, 363); formatSchedule is copied in Classes and ClassDetail with a stale 'Vietnamese-only' comment (shared formatScheduleText is already localized); goBack is copied in InvoiceDetail and TeacherDetail; the phone regex is copied in Students, Teachers and Leads and is looser than shared isValidVNPhone.

#### `client-admin/ADM-19` — i18n and money-format gaps: raw method strings, unformatted reward amounts, raw timestamps
`client/src/features/tuition/Tuition.tsx:142` · frontend · unverified-low

PendingPayments shows `p.method` raw (legacy Vietnamese strings or 'vnpay') instead of using paymentMethodLabel. Refund rows in InvoiceDetail show method 'refund' untranslated. ReferralsAdmin.tsx:121 prints reward_amount as a bare number without formatVND. ResetRequests.tsx:107 and ZaloReminders.tsx:400 show raw `created_at.slice(0,16)` instead of formatDateTime.

#### `client-admin/ADM-20` — Field error ids contain spaces, so aria-describedby never resolves; tabs lack ARIA
`client/src/shared/components/Form.tsx:28` · frontend · unverified-low

errorId is `${label}-error`, and labels like 'Số tiền' contain spaces. aria-describedby is a space-separated IDREF list, so it points at two nonexistent ids, and identical labels collide. The tab strips in Tuition.tsx:40-50 and ReviewsAdmin.tsx:92-105 are plain buttons with no role=tab or aria-selected. The schedule time inputs (Classes.tsx:513-525) have no accessible name.

#### `client-admin/ADM-21` — Actions are shown to roles that will get 403
`client/src/features/classes/Rooms.tsx:76` · frontend · unverified-low

Staff (rooms.view only, no *.delete, teachers.view only, payroll.view only) still see Add/Edit/Delete on Rooms, Delete on Students and Classes, Add/Account/Delete on Teachers, and 'Đơn giá' on Payroll. InvoiceList shows Collect and Refund ungated, while InvoiceDetail gates Collect with rolesApi.mine(). The server enforces permissions correctly, so this is a UX problem only.

#### `client-admin/ADM-22` — Load failures show 'not found' with no retry; 'Collect' on invoice detail loses context
`client/src/features/classes/ClassDetail.tsx:96` · frontend · unverified-low

ClassDetail and StudentDetail (StudentDetail.tsx:66) treat any load error, including a network error or timeout, as 'Không tìm thấy' and offer no retry. InvoiceDetail and TeacherDetail already distinguish notFound from load errors. StudentDetail also doesn't reset loading or data when :id changes. InvoiceDetail's 'Thu tiền' (InvoiceDetail.tsx:167) just navigates to the /app/tuition list instead of opening PayModal for this invoice. ApplyCreditModal asks staff to type a raw DB credit id.

#### `client-admin/ADM-23` — GET timeout retry never works: the retry reuses an already-aborted signal
`client/src/shared/api/client.ts:128` · ops · unverified-low

One AbortController and timer are created before the retry loop. After the first timeout aborts it, the retry calls fetch with the same aborted `controller.signal`, which rejects immediately with AbortError, and that is reported as a timeout. The timer is also only cleared on the success path.

#### `client-core/FE-1` — Modal re-runs its whole setup effect on every parent render: focus jumps to the first field and nested-modal Escape order breaks
`client/src/shared/components/Modal.tsx:90` · frontend · plausible (ban đầu: medium)

The mount effect depends on [onClose], and most callers pass inline arrows (Roles.tsx:544/557, Attendance.tsx:413, LeavesAdmin.tsx:168, ResetRequests.tsx:134, ZaloReminders.tsx:452, System.tsx children). Each parent re-render runs cleanup and setup again. Cleanup restores focus to the opener, then setup moves focus back to the first focusable, resets body overflow, and pops and re-pushes the modal onto modalStack. Commit 5d820ab worked around this only in HomeworkFormModal (useRef for isDirty); the root cause is still in Modal.

#### `client-core/CORR-6` — The 'retry once on timeout' never retries because both attempts share one already-aborted AbortController
`client/src/shared/api/client.ts:117` · correctness · unverified-low

One controller and one timer are created before the retry loop. After the timer aborts the first attempt, the retry passes the same aborted signal, fetch rejects immediately with AbortError, and the timeout error is thrown after a pointless 500 ms wait. The timer also spans the 5xx retry. A caller-supplied options.signal disables the timeout entirely, and caller aborts are rewritten into the 'timeout' message.

#### `client-core/CORR-7` — useSecureFileUrl and uploadFile read getToken() directly and skip the refresh-on-401 logic
`client/src/shared/components/SecureFile.tsx:21` · correctness · unverified-low

Both functions attach the in-memory access token (15 min lifetime) and handle 401 as a plain failure. features/homework/homework.api.ts:29 does the same for XHR uploads. Neither goes through api(), so the token is never refreshed.

#### `client-core/CORR-8` — Roles page: stale detail responses can win, and switching roles silently discards unsaved permission edits
`client/src/features/system/Roles.tsx:195` · correctness · unverified-low

loadDetail(id) has no guard against out-of-order responses, so a slower response for a previously selected role overwrites detail. Changing selectedId runs setDraft({}) without checking 'dirty'.

#### `client-core/PERF-1` — manualChunks defeats lazy-loading: landing, login and every locale for both languages load on every page
`client/vite.config.ts:20` · performance · unverified-low

Landing and auth are forced into the 'public' manual chunk. Rollup pulls their unassigned dependencies into it: i18n with all 26 locale JSONs, icons, the api client, toast. The entry then imports public-*.js statically (173 KB minified in dist), so Landing.tsx and Login code plus both languages' strings load on every admin, parent and teacher page.

#### `client-core/FE-3` — Field builds aria-describedby ids from translated labels that contain spaces, so the reference never resolves
`client/src/shared/components/Form.tsx:28` · frontend · unverified-low

errorId = `${label}-error` produces ids like 'Tên đăng nhập-error'. aria-describedby is a whitespace-separated IDREF list, so it is parsed as three ids, none of which exist. Two fields with the same label also produce duplicate ids.

#### `client-core/FE-4` — Unknown sub-routes under /app, /parent and /teacher render an empty layout instead of the 404 page
`client/src/app/App.tsx:158` · frontend · unverified-low

The splat parent routes have no '*' child, so a URL like /app/settings matches the parent and <Outlet/> renders nothing. The top-level NotFound route is never reached.

#### `client-core/SEC-3` — The inline theme script in index.html forces CSP script-src 'unsafe-inline'
`client/index.html:5` · security · unverified-low

The FOUC script is inline, so helmet's CSP (server app.ts:73) allows 'unsafe-inline' scripts. That removes CSP's main XSS mitigation. Keeping the token in memory does not stop injected script, which can call /api/v1/auth/refresh (same-origin, cookie sent) to obtain fresh tokens.

#### `client-core/FE-5` — Missing i18n key: the role-search clear button's aria-label reads the literal 'clear'
`client/src/features/system/Roles.tsx:344` · frontend · unverified-low

t('clear', { ns: 'common' }) is used, but neither vi/common.json nor en/common.json has a top-level 'clear' key. The locales parity test does not detect keys that are used in code but undefined.

#### `client-core/OPS-1` — Broken social/SEO metadata: missing og:image file, and relative URLs in sitemap.xml and robots.txt
`client/index.html:25` · ops · unverified-low

og:image and twitter:image point to /landing-hero.jpg, which exists in neither public/ nor dist/. sitemap.xml has <loc>/</loc> and robots.txt has 'Sitemap: /sitemap.xml'. The sitemap protocol requires absolute URLs, so crawlers ignore both.

#### `client-core/OPS-2` — The Vite dev proxy does not forward /uploads, so file previews are broken in development
`client/vite.config.ts:8` · ops · unverified-low

Only '/api' is proxied, but uploaded files are served by Express at /uploads/:filename. In dev, Vite answers those requests with index.html.

#### `client-core/CORR-9` — Receipt print date uses the UTC day, and the center name is always a placeholder
`client/src/shared/components/ReceiptModal.tsx:22` · correctness · unverified-low

new Date().toISOString().slice(0,10) gives the UTC date. shared/types.ts:194 already provides todayVN() for exactly this. Both callers pass centerName = t('receipt.defaultCenter') instead of the tenant's real name.

#### `client-core/FE-6` — Change-password shows every server error under the 'current password' field
`client/src/shared/components/ChangePasswordModal.tsx:44` · frontend · unverified-low

The catch block always calls show({ old: err.message }). The server also returns WEAK_PASSWORD (common-password list) and SAME_PASSWORD, which concern the new password.

#### `client-core/SEC-4` — Logout does not clear the saved deep-link (edu_next)
`client/src/shared/api/client.ts:43` · security · unverified-low

clearAuth() and logout() remove only the token and edu_user. The sessionStorage 'edu_next' set by RoleGuard or by the 401 handler survives in that tab.

#### `client-portals/COR-9` — List fetches have no guard against out-of-order responses
`client/src/features/homework/QuestionBank.tsx:90` · correctness · confirmed (ban đầu: medium)

None of the list fetches cancel or sequence requests. In QuestionBank, changing a filter while page>1 always sends two requests: load(newFilter, oldPage) and then, after the setPage(1) effect, load(newFilter, 1). Whichever response arrives last wins. Homework.tsx:79 (filters/tab/page), TeacherSalary.tsx:23 (month stepping) and TeacherGrades.tsx:60 (pickClass students) have the same pattern.

#### `client-portals/PERF-1` — Parent home loads the full child overview per child just to compute debt, and blocks the list
`client/src/features/parent/ParentHome.tsx:34` · performance · confirmed (ban đầu: medium)

load() fetches /parent/children, then calls childOverview for each child. Each overview is the heaviest parent endpoint: classes, sessions, attendance, invoices with one confirmedPaid query per invoice, grades, homework and credits. `loading` stays true until every overview settles, so the child cards keep showing a skeleton even though `children` is already loaded.

#### `client-portals/FE-6` — ChildDetail swaps the whole page for a skeleton on every refetch
`client/src/features/parent/ChildDetail.tsx:68` · frontend · unverified-low

onChanged/onPaid call load(), which sets loading=true, and the component returns the page skeleton. Every tab component unmounts (losing local state such as an open modal) and the page height collapses, so the scroll position jumps to the top.

#### `client-portals/COR-10` — Closing QuizTaker with X after submitting leaves ChildDetail stale
`client/src/features/parent/ChildDetail.tsx:671` · correctness · unverified-low

Only the explicit 'Close' button (onDone) triggers onChanged(). The header X, Escape and backdrop call onClose, which just clears takingQuiz, even when a result has already been recorded.

#### `client-portals/PERF-2` — Student picker refetches every selected class's full detail on each toggle
`client/src/features/homework/HomeworkFormModal.tsx:233` · performance · unverified-low

The effect depends on the selectedClasses array and runs Promise.all(classesApi.get(id)) for every selected class each time any class is toggled, with no cache.

#### `client-portals/COR-11` — Edit-mode loaders fail silently and can overwrite edits already in progress
`client/src/features/homework/HomeworkFormModal.tsx:158` · correctness · unverified-low

getQuizEdit and getQuizAttempts both use `.catch(() => {})`. If loading the quiz fails, the builder shows a single blank question with no error, and if it resolves late it calls setQuestions directly, overwriting whatever the teacher has typed. A failed attempts check leaves quizLocked=false.

#### `client-portals/FE-7` — Hardcoded user-facing strings bypass i18n
`client/src/features/homework/homework.api.ts:39` · frontend · unverified-low

uploadFile has hardcoded Vietnamese error messages (lines 39, 43, 51, 52), and ChildDetail.tsx:567 renders a literal 'Quiz' badge. A script check confirmed every static t() key in scope exists in both vi and en, so these are the only gaps.

#### `client-portals/FE-8` — Icon-only remove buttons have no accessible name, and Field's aria-describedby id contains spaces
`client/src/features/homework/HomeworkFormModal.tsx:1095` · frontend · unverified-low

The '×' buttons for removing a question (1095), an option (1164) and a rubric criterion (1025) have no aria-label; the QuestionBank versions do. Field builds `errorId = `${label}-error``, and labels such as 'Tiêu đề' or counts produce ids with spaces, so aria-describedby splits into several invalid IDREFs (Form.tsx:30).

#### `client-portals/COR-12` — Failed payment page shows the 'pending' badge text
`client/src/features/parent/PaymentResult.tsx:68` · correctness · unverified-low

The badge label is `success ? paidBadge : pendingBadge`, so a failed or cancelled payment shows the red badge with the 'pending' text under a 'Payment failed' title.

#### `client-portals/ARCH-1` — Oversized components and duplicated quiz-editing logic
`client/src/features/homework/HomeworkFormModal.tsx:34` · architecture · unverified-low

HomeworkFormModal is 1,311 lines with about 40 useState hooks, covering targeting, attachments and uploads, rubric creation, the quiz builder, publishing, preview and the dirty-check. Quiz validation, question-type switching and correct-answer toggling are written twice, once here (isQuizQuestionInvalid, changeQuestionType, updateOption) and once in QuestionBank's BankQuestionForm (save, changeQtype, toggleCorrect); QType and BLANK_OPTIONS are also duplicated. removeAttachment triggers a network side effect inside a setState updater (line 307).

#### `client-portals/TEST-1` — No component or flow tests for the portals
`client/src/features/homework/HomeworkFormModal.test.ts:1` · testing · unverified-low

In this scope, tests cover only four pure helpers in HomeworkFormModal. There are no React Testing Library tests for the edit flow, QuestionBank, QuizTaker, ChildDetail or the teacher pages, and no contract test between client and server response shapes such as attendance.rate.

#### `cross-cutting/ARCH-2` — RBAC scope enforced by role literal in classes/sessions, so custom-role scopes are ignored
`server/src/modules/classes/classes.service.ts:48` · architecture · unverified-low

classScopeWhere and sessions.service restrict data with `ctx.role === 'teacher'` instead of the permission scope. Homework was already migrated to permission-scope-based ownScoped (P0-1 tests), so the codebase now has two authorization models.

#### `cross-cutting/ARCH-3` — Layering rules in ARCHITECTURE/CONTRIBUTING are not followed: SQL and ad-hoc error responses in routes, business code in three places, god files
`server/src/modules/auth/auth.routes.ts:224` · architecture · unverified-low

Docs say 'Mọi db.prepare nằm trong service' and 'Không res.status(4xx)'. In practice db access appears in 9 route files (auth 10 calls, teachers 8, reviews 6, leads 5, roles 5, rooms 4, trials 3, zalo, centers), and 14 route files hand-roll res.status(4xx).json, which skips request_id and the AppError envelope. Business logic lives in modules/*/service, services/ (e.g. services/referrals.ts alongside modules/referrals/referrals.service.ts) and db/helpers.ts (recalcInvoiceStatus). dashboard.routes exports business functions that tests import. Large files include schema.ts (1815 lines), HomeworkFormModal.tsx (1311), Tuition.tsx (1044) and homework.service.ts (920).

#### `cross-cutting/ARCH-4` — Runtime SQLite-to-PostgreSQL rewriting layer and TEXT timestamps are structural debt
`server/src/db/pg-compat.ts:72` · architecture · unverified-low

Every query is passed through a hand-written lexer that rewrites ? to $n, LIKE to ILIKE globally, datetime('now') and INSERT OR IGNORE. All timestamps are TEXT 'YYYY-MM-DD HH24:MI:SS', and the cleanup jobs compare them with to_char(NOW()-INTERVAL ...).

#### `cross-cutting/TEST-3` — Critical modules and the HTTP permission wiring have no tests; client tests cover only pure helpers
`server/src/modules/centers/centers.routes.ts:12` · testing · unverified-low

There are no tests for centers (tenant creation and plan changes), public (the unauthenticated trust boundary and tenant resolution), referrals/credits (money), teacher check-in, leaves approval, reviews or audit. Only 3 server tests exercise HTTP through createApp, so the mapping of routes to requirePermission/denyParents and the reset-request cross-tenant path are unverified. The 6 client test files test pure functions only, with no component or hook tests, and shared/api/client.ts refresh/retry logic is untested. Where tests exist they are good (race tests, IDOR regressions).

#### `cross-cutting/OPS-6` — Documentation drift on auth flow, paths, versions and counts
`docs/API.md:15` · ops · unverified-low

API.md says login returns refresh_token in the body and the token lives 1h. In the code, refresh_token is an HttpOnly cookie (D4) and the default TTL is 15m. API.md places Swagger at /api-docs (the code serves /api/docs) and lists /health as public under v1 (it requires auth plus system.manage). ARCHITECTURE.md claims 162 server and 12 client tests (actual 369/52) and a barrel index.ts per module (only 2 exist). GO-LIVE.md says audit log 'chưa có' and no HTTPS guide, but both exist. README says Node 18+, but ESLint 10 needs >=20.19. DEPLOYMENT runs `npx tsx scripts/create-superadmin.ts` from the repo root, while the script lives in server/scripts. app.ts comments claim no cookies are used. openapi.yaml lacks 9 operations, including forgot-password, reset-requests, vnpay-ipn and parent consent.

#### `cross-cutting/OPS-7` — Dependency hygiene: unmaintained yamljs and Swagger in prod deps, broken SQLite migration script, unchecked scripts
`server/package.json:13` · ops · unverified-low

yamljs (last release 2017, the source of the argparse/sprintf-js advisory) and swagger-ui-express are production dependencies even though Swagger is disabled when IS_PROD. scripts/migrate-sqlite-to-pg.ts imports better-sqlite3, which is not declared or installed, so the README migration command fails. Neither scripts/ nor server/scripts/ is covered by any tsconfig or the eslint globs. The root devDependencies duplicate @typescript-eslint/* alongside typescript-eslint. react-router-dom carries 2 moderate advisories.

#### `cross-cutting/OPS-8` — Boot-time schema creation races between PM2 workers; migration runner does not re-check after taking its lock
`server/src/db/index.ts:15` · ops · unverified-low

initDatabase runs createSchema, createIndexes, createTriggers and createViews on every worker boot with no lock. On an empty DB, two cluster workers hit the same 23505 duplicate pg_type error seen in the tests, and one crashes. runMigrations reads `applied` before acquiring pg_advisory_xact_lock and does not re-read it afterwards, so both workers execute each pending migration's up(). That is safe only because the current migrations happen to be idempotent.

#### `cross-cutting/SEC-5` — Custom role codes are globally unique although roles are per-tenant
`server/src/db/schema.ts:790` · security · unverified-low

roles.code has a global UNIQUE constraint, yet custom roles carry center_id. The POST /roles catch block maps any insert error to 'Mã vai trò đã tồn tại'.

#### `cross-cutting/SEC-6` — create-superadmin takes the password on argv and never closes the pool
`server/scripts/create-superadmin.ts:14` · security · unverified-low

The documented production bootstrap passes the superadmin password as a CLI argument, so it ends up in shell history and is visible in `ps`. It finishes with `db.end?.()`, but db has no end method (closePool exists), so the process hangs until the pool idle timeout. The script is not type-checked because it is outside every tsconfig.

#### `server-core/SEC-6` — Public endpoints misroute leads and trial registrations (PII) to center #1 when the Host is unknown
`server/src/utils/plans.ts:79` · security · plausible (ban đầu: medium)

resolvePublicCenter takes the first label of the Host header. If no center has that subdomain (apex domain, custom domain, typo, or a spoofed Host) it silently falls back to getDefaultCenter(), the lowest center id. The public routes then INSERT leads and trial_registrations with that center_id (public.routes.ts:130-154, 166-219) and show that center's classes, teachers and reviews.

#### `server-core/SEC-10` — Global ops endpoints gated by system.manage, which every center admin holds
`server/src/modules/metrics/metrics.routes.ts:23` · security · unverified-low

Admin gets ALL_PERMS('center'), which includes system.manage. centers.routes.ts:16-19 explicitly says that is not enough and adds a role check. /api/v1/metrics and /api/v1/health (app.ts:194) rely on requirePermission('system.manage') alone.

#### `server-core/SEC-11` — Role management gaps: cross-center role read, unvalidated permissions payload, global role-code namespace
`server/src/modules/authorization/roles.routes.ts:63` · security · unverified-low

GET /roles/:id has no center check, so any admin can enumerate other centers' custom roles and their permissions. PUT /:id/permissions takes req.body.permissions without validation: a non-array object throws inside the transaction and returns 500. roles.code is globally UNIQUE (schema.ts:790), so center A creating 'accountant' blocks every other center from using that code, and POST / maps every DB error to 'Mã vai trò đã tồn tại'.

#### `server-core/SEC-12` — Refresh grace window can mint new sessions after logout-all or password change
`server/src/modules/auth/refresh.service.ts:189` · security · unverified-low

A token revoked by rotation less than 30s ago (replaced_by set) always gets a fresh pair. revokeAllForOwner / revokeAllForOwnerExcept only update rows with revoked_at IS NULL, so they do not mark already-rotated tokens. A rotated token therefore stays usable for grace issuance even after the user revoked everything.

#### `server-core/SEC-13` — CSP allows script-src 'unsafe-inline', which removes its XSS protection
`server/src/app.ts:73` · security · unverified-low

The only inline script is the theme bootstrap in client/index.html:5-15. Allowing 'unsafe-inline' for scripts lets any injected inline script run. The access token lives in JS memory, so XSS means token theft.

#### `server-core/CORR-3` — publicRateLimit instances share one IP-keyed bucket map
`server/src/middleware/rateLimit.ts:33` · correctness · unverified-low

All publicRateLimit(...) instances use the module-level `buckets` Map keyed only by IP. /client-errors and the 6 public routes therefore share one counter and one window, whichever created it first.

#### `server-core/CORR-4` — Missing type checks on auth inputs and the cookie decode turn bad input into 500s
`server/src/modules/auth/auth.routes.ts:38` · correctness · unverified-low

login and change-password cast req.body without checking types. A non-string password makes bcrypt.compareSync throw 'Illegal arguments', which becomes a 500 with a stack trace logged at error level. getRefreshCookie (cookieAuth.ts:40) calls decodeURIComponent unguarded, so a malformed cookie value throws URIError and returns 500 on /refresh and /logout.

#### `server-core/OPS-1` — Stale security comment and multi-path dotenv loading with silent precedence
`server/src/config/env.ts:9` · ops · unverified-low

The uncommitted change loads .env from cwd, server/ and the repo root, on top of pg-compat.ts:6 which already calls dotenv.config(). Precedence is first-wins and nothing logs which file supplied a key: tests print 'injected env' 4 times, and a dev root .env can silently fill keys missing from the prod server/.env. Separately, app.ts:58-59 says auth uses Bearer tokens in localStorage and no cookies, while refresh actually runs over HttpOnly cookies and the access token is kept in memory. The CSRF reasoning in that comment is wrong.

#### `server-data/DATA-16` — createIndexes' composite index definitions are silent no-ops because migrations already created single-column indexes with the same names; it also restores an index that v14 dropped
`server/src/db/indexes.ts:16` · performance · unverified-low

Boot order is runMigrations, then createIndexes. v7 and v9 create idx_students_center(center_id), idx_invoices_student(student_id), idx_payments_invoice(invoice_id), idx_homework_class(class_id), idx_enrollments_class(class_id) and idx_attendance_student(student_id). createIndexes then asks for (center_id,status), (student_id,status) and so on under the same names, and IF NOT EXISTS skips them. The test DB confirms the single-column definitions. The last line also recreates the partial parent_reviews_unique that v14 dropped, so reviews ends up with 3 unique indexes on (parent_id, center_id). Several other indexes duplicate UNIQUE or PK indexes (idx_users_username, idx_students_code, idx_refresh_token_hash, idx_salary_rules_teacher).

#### `server-data/DATA-17` — poolQuery blindly retries statements after ambiguous connection errors, which can duplicate non-idempotent writes
`server/src/db/pg-compat.ts:299` · correctness · unverified-low

In the no-actor path (public endpoints, jobs, boot), any statement that fails with ECONNRESET, 57P01 or 08006 is re-run after 300 ms. For an autocommit INSERT or UPDATE, the server may already have committed before the connection dropped.

#### `server-data/DATA-18` — The audit trigger keeps only the numeric part of 'id:role', so staff user #N and parent #N cannot be told apart in payment and invoice history
`server/src/db/schema.ts:1590` · security · unverified-low

v_changed_by is split_part(app.user_id, ':', 1)::INTEGER. users.id and parents.id are separate sequences.

#### `server-data/DATA-19` — recalcInvoiceStatus always UPDATEs, which bumps version and writes invoice_history even when nothing changed
`server/src/db/helpers.ts:190` · correctness · unverified-low

`UPDATE invoices SET status = ? WHERE id = ?` runs unconditionally. The audit_invoice trigger then increments version and inserts a history row.

#### `server-data/DATA-20` — POST /invoices/:id/remind sends a 429 inside the lock callback, then calls res.json(undefined) again
`server/src/modules/zalo/zalo.routes.ts:255` · correctness · unverified-low

When `recent` is found, the callback writes the 429 and returns undefined, so withAdvisoryLock reports status 'done'. Line 272 then calls res.json(lockOutcome.result) and throws ERR_HTTP_HEADERS_SENT.

#### `server-data/DATA-21` — Demo seed uses hard-coded IDs and inserts invoices without center_id
`server/src/db/seed.ts:160` · correctness · unverified-low

The seed assumes teacher ids 1-3, class ids 1-3 and student ids 1-12. It inserts invoices with no center_id and recalculates every invoice in the database. It runs whenever SEED_DEMO=true and the users table is empty, not only when the database is empty.

#### `server-data/DATA-22` — The migration script's TRUNCATE ... CASCADE also wipes RBAC tables and refresh tokens it never re-populates
`scripts/migrate-sqlite-to-pg.ts:122` · ops · unverified-low

Truncating centers and users with CASCADE also truncates roles (FK to centers), role_permissions, user_roles and refresh_tokens. None of these are in TABLE_ORDER.

#### `server-data/DATA-23` — backup.ts rebuilds the connection from URL parts and drops query parameters such as sslmode
`server/src/db/backup.ts:47` · ops · unverified-low

Only host, port, database, user and password are passed to pg_dump. Options such as ?sslmode=require or ?host=/socket in DATABASE_URL are discarded.

#### `server-data/DATA-24` — create-superadmin takes the password on argv and never closes the pool
`server/scripts/create-superadmin.ts:37` · ops · unverified-low

Db has no end() method, so `db.end?.()` does nothing and the script hangs until the pool's idle timeout. The password is passed as a CLI argument.

#### `server-data/DATA-25` — Uncommitted env.ts change loads .env from three locations, weakening the DATABASE_URL fail-fast check
`server/src/config/env.ts:10` · ops · unverified-low

dotenv.config() now runs for cwd, ../../.env and ../../../.env relative to dist/config, on top of pg-compat's own dotenv.config(). The first file that defines a variable wins.

#### `server-domain/COR-7` — Lead conversion retries a unique violation inside an aborted PostgreSQL transaction
`server/src/modules/leads/leads.service.ts:128` · correctness · unverified-low

After a 23505 on the INSERT, the catch block continues the loop inside the same transaction, which has no SAVEPOINT (pg-compat db.transaction offers none). PostgreSQL has already aborted the transaction, so the next statement fails with 25P02 and the retry can never succeed.

#### `server-domain/COR-8` — Converted leads can be reverted and converted again, creating duplicate students
`server/src/modules/leads/leads.routes.ts:127` · correctness · unverified-low

PUT blocks setting status TO 'enrolled' or 'converted' but allows moving away from it (same in trials.routes.ts:37-55). For leads, the duplicate-phone guard compares normalizePhone(lead.phone) with students.phone, but the student is inserted with the raw lead.phone (leads.service.ts:108-112 vs 125). Staff-entered phones with spaces or a +84 prefix are therefore never matched.

#### `server-domain/SEC-7` — Dashboard shows center-wide data to 'own'-scope teachers
`server/src/modules/dashboard/dashboard.routes.ts:84` · security · unverified-low

Only revenue and unpaid totals are hidden for the reports.view 'own' scope. Teachers still get center-wide student, teacher and class counts and every class's today sessions with teacher names.

#### `server-domain/PERF-2` — One shared public rate-limit bucket per IP, and no dedupe on lead/trial forms
`server/src/middleware/rateLimit.ts:31` · performance · unverified-low

publicRateLimit keys its bucket by IP only, across all endpoints. A landing page (center, classes, teachers, reviews = 4 GETs), form submissions and /client-errors all share 20 requests per minute per IP. Under the CGNAT common on Vietnamese mobile carriers, real visitors get 429s. Meanwhile POST /public/leads and /trials never dedupe on (center, phone), so spam still creates rows.

#### `server-domain/COR-9` — Auto student code is a 6-digit timestamp suffix under a global UNIQUE constraint
`server/src/modules/students/students.service.ts:120` · correctness · unverified-low

`HV${Date.now().slice(-6)}` repeats every ~16.7 minutes, and students.code is UNIQUE across all tenants. The collision rate per create grows as N_total/1e6, and the existence check (line 121) also tells one tenant which codes another tenant uses. The same generator is duplicated in trials.service.ts:60 and leads.service.ts:65.

#### `server-domain/PERF-3` — Public parent login and register run synchronous bcryptjs on the event loop
`server/src/modules/parent/parent.service.ts:176` · performance · unverified-low

loginParent uses compareSync and registerParent uses hashSync (line 141), and so does teachers.routes.ts:156. Pure-JS bcrypt at cost 10 blocks the Node event loop for about 70-100ms per call on public endpoints. loginRateLimit is per IP, so a distributed caller can stall the worker for every tenant.

#### `server-domain/OPS-1` — Some destructive or approval actions have no audit entry
`server/src/modules/rooms/rooms.routes.ts:138` · ops · unverified-low

No audit is written for room DELETE, review reject/DELETE (reviews.routes.ts:85,105), lead DELETE (leads.routes.ts:170), trial status PUT, or leave approve/reject. Approve-review, room create/update, class, student and session deletes are audited, so the trail is inconsistent.

#### `server-homework/HW-7` — File access check ignores RBAC and keys off the role literal 'teacher'
`server/src/shared/uploadAccess.ts:55` · security · confirmed (ban đầu: medium)

Any non-parent, non-teacher role in the same center is allowed, with no homework.view or homework.grade permission check. Own-scope enforcement only applies when role === 'teacher'. P0-1 moved homework routes to permission scope (ownScoped), but file access was not updated.

#### `server-homework/HW-14` — No index on homework_submissions.file_url; every file view does a sequential scan
`server/src/shared/uploadAccess.ts:31` · performance · confirmed (ban đầu: medium)

checkUploadAccess queries `WHERE hs.file_url = ?`, and again for teachers (line 50). indexes.ts and migrations only index (homework_id, student_id).

#### `server-homework/HW-16` — Uploaded-but-never-attached files are orphaned forever
`server/src/modules/uploads/uploads.routes.ts:25` · ops · unverified-low

Orphan cleanup depends entirely on the client calling DELETE when the modal is cancelled. A closed tab, crash or network error leaves the file. Uploads are not tracked in the DB and there is no sweeper.

#### `server-homework/HW-17` — PUT /:id/quiz accepts non-quiz homework and overwrites its max_score
`server/src/modules/homework/quiz.service.ts:85` · correctness · unverified-low

saveQuizQuestions never checks homework.kind, unlike importFromBank (P1-7). It inserts quiz_questions and sets max_score = sum(points) on a regular homework.

#### `server-homework/HW-18` — submitQuiz reads questions outside the row lock; a concurrent re-save of questions causes an FK error or wrong grading
`server/src/modules/homework/quiz.service.ts:267` · correctness · unverified-low

Questions and options are loaded and graded before `SELECT ... FOR UPDATE`. saveQuizQuestions can delete and reinsert questions in between, because no attempt exists yet. attemptNo is also computed outside the transaction, so duplicate numbers are possible.

#### `server-homework/HW-19` — Create allows max_score 0 but update/grade reject it, so such homework can't be graded
`server/src/modules/homework/homework.service.ts:277` · correctness · unverified-low

prepareCreateInput only rejects max_score < 0. updateHomework requires > 0 (line 582), and gradeHomework rejects score > max_score.

#### `server-homework/HW-20` — Parent submit route leaves the uploaded file on disk when homeworkId/ctx validation throws
`server/src/modules/parent/parent.routes.ts:418` · ops · unverified-low

multer writes the file before ctx(req) and paramId(...), and both run outside the try/cleanup block.

#### `server-homework/HW-21` — createRubric silently coerces invalid criterion max_score to 0, with no upper bound
`server/src/modules/homework/rubric.service.ts:79` · correctness · unverified-low

`Math.max(0, Number(c.max_score) || 0)` turns 'abc' or negative values into 0 and accepts 1e308. Name lengths are unbounded. The rest of the module returns 400 instead of clamping (P1-7).

#### `server-homework/ARCH-1` — Repository layer is bypassed and partly dead code
`server/src/modules/homework/homework.repo.ts:42` · architecture · unverified-low

homework.repo.ts states that services do not write SQL, yet homework.service.ts and quiz.service.ts are full of raw SQL. homeworkRepo.insert and findDueScheduled are unused; insertHomeworkTx duplicates insert. homework.service.ts (920 lines) mixes validation, SQL, file I/O and events.

#### `server-money/TEST-2` — VNPay tests are self-referential (sign with the same algorithm under test)
`server/src/modules/payments/payments.ipn.test.ts:53` · testing · unverified-low

vnpaySign reimplements the production sort+raw-join algorithm, so the IPN and return tests can only prove internal consistency, not compatibility with VNPay. There are also no tests for referral rewards (afterInvoicePaid), applyCreditToInvoice, the idempotency middleware, or payroll correctness (payroll.perf only checks that bulk equals single).

#### `server-money/PAY-6` — IPN maps a failed or cancelled payment to '04 Invalid amount'
`server/src/modules/payments/payments.service.ts:243` · correctness · unverified-low

reason 'payment_failed' covers both an amount mismatch and vnp_ResponseCode != '00' (customer cancelled, insufficient funds). VNPay expects the merchant to acknowledge a valid failed-transaction IPN with 00 after updating its state. Answering 04 makes VNPay record a merchant error and retry. vnp_TransactionStatus is also never checked alongside ResponseCode.

#### `server-money/PAY-7` — Unauthenticated IPN reveals txn existence and confirmation before signature check
`server/src/modules/payments/payments.service.ts:64` · security · unverified-low

confirmVnpayTxn returns 'confirmed' (→ 00) or 'notfound' (→ 01) from the unlocked lookup before verifying vnp_SecureHash. Refs are predictable (`HD<invoiceId>_<ms>`).

#### `server-money/INV-3` — Amounts are rounded after the positivity check (0.4 → 0)
`server/src/modules/invoices/invoices.service.ts:62` · correctness · unverified-low

assertPositiveAmount checks amt > 0 and then returns Math.round(amt). An input of 0.4 becomes 0.

#### `server-money/INV-4` — Credit-restore loop in deleteInvoice is unreachable dead code
`server/src/modules/invoices/invoices.service.ts:288` · architecture · unverified-low

Credit payments are always inserted with status 'confirmed', and deleteInvoice throws earlier when any confirmed payment exists. The block that parses 'credits #N' from note and restores used_amount can never run. That is misleading, and it relies on parsing free-text notes for money linkage.

#### `server-money/REF-2` — Referral reward silently dropped if advisory lock is still busy after one 2s retry
`server/src/services/referrals.ts:59` · correctness · unverified-low

afterInvoicePaid runs after commit, uses pg_try_advisory_lock, retries once after a 2s sleep inside the HTTP/IPN request, then only logs a warning. There is no durable retry, and a crash between commit and reward also loses it. Each call holds a dedicated pool client while fn opens another (db.transaction), so it uses 2 connections per paid event.

#### `server-money/AUTHZ-1` — Money routes accept any scope ('own') but services always act center-wide
`server/src/modules/payments/payments.routes.ts:52` · security · unverified-low

requirePermission defaults minScope to 'own', and the payment, invoice, refund and payroll services ignore scope and operate on the whole center. A custom role created in the UI with 'payments.approve: own' or 'payments.refund: own' therefore gets full center-wide approve/refund power.

#### `server-money/REF-3` — Referral stats total_reward counts only referrer-side credits and scopes by parent center
`server/src/modules/referrals/referrals.routes.ts:55` · correctness · unverified-low

total_reward matches `reason LIKE 'Thưởng giới thiệu%'` only. Referred-side credits ('Ưu đãi học viên được giới thiệu…') are excluded, and the filter uses parents.center_id rather than credits.center_id. It also relies on free-text reason strings for accounting.
