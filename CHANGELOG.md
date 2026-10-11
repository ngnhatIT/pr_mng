# Changelog — EduCenterPro

## 2026-10-11 — Review fixes, vòng 7

Không có migration mới (vẫn v25).

### Bảo mật / tính đúng đắn

- N6-1: role riêng của trung tâm chỉ gán được cho người cùng trung tâm, kể cả superadmin ở chế độ toàn hệ thống (404).
  Ô chọn người trong UI lấy `GET /roles/users?center_id=<trung tâm của role>`. Kiểm tra nhất quán thêm
  `role_cross_center` để báo các gán lệch có từ trước; gỡ (`DELETE /roles/assign`) vẫn cho phép để dọn.
- N6-3: người được ủy quyền `roles.manage` không gán/gỡ vai trò của tài khoản hạng cao hơn mình (403). Đây là cùng
  luật hạng với đặt lại mật khẩu (`ROLE_RANK` chuyển sang `authorization.service`).
- Lương: `GET /payroll` và `/teacher/payroll` thêm `month_rate`, là đơn giá của chính tháng đó (giá buổi cuối tháng;
  tháng không có buổi lấy giá hiệu lực ngày cuối tháng). `mixed_rates` giờ chỉ `true` khi các buổi trong tháng tính
  theo hơn 1 đơn giá. Trước đây tháng 9 trả trọn 200.000đ vẫn hiện "250.000đ — Đơn giá đổi trong tháng" sau khi đổi giá
  hôm nay. `per_session` vẫn là đơn giá hiện hành (tương thích ngược). Bản chốt trước vòng 7 giữ cách tính cũ.
- Mã vai trò tự sinh bỏ dấu tiếng Việt và gộp ký tự lạ: "Kế toán B6" cho ra `ke_toan_b6` (trước là `k__to_n_b6`).
  Mã chỉ gồm ký tự lạ thì trả 400.
- Rate limit: GET/HEAD của tài khoản đã đăng nhập có trần riêng 1500 / 15 phút. Trước đây 300 hết sau khoảng 65 lần
  chuyển trang. Cổng phụ huynh: GET 1000, còn lại 200. Ghi, ẩn danh, login và upload giữ nguyên trần.

### UI/UX (client)

- Thẻ cuối của mọi bảng `.table-stack` không còn lệch phải/giãn nút (lỗi specificity CSS của vòng 6).
- Lương / Lương của tôi hiện `month_rate`. Gợi ý "đơn giá đổi trong tháng, bình quân X" chỉ hiện khi tháng thật sự
  có nhiều đơn giá.
- Focus:
  - Gán/gỡ thành viên vai trò xong, focus chuyển về ô chọn người (hoặc tiêu đề mục).
  - Bấm "Thử lại" thành công, focus chuyển về `#main-content` thay vì rơi về `<body>`.
- Truy cập:
  - Mọi `Tabs` có `aria-label` (bắt buộc). Tab "Tất cả" có id `…-tab-all`.
  - Trạng thái điểm danh, phạm vi quyền và đáp án quiz dùng `role=group` + `aria-pressed` thay cho `role=radio`
    (trước đây có vai trò radio nhưng không điều hướng được bằng phím mũi tên).
  - `EmptyState icon="alert"` có `role=alert`: Tổng quan, Cấu hình thanh toán, các trang chi tiết và modal tải lỗi.
- Tạo vai trò:
  - Ô mã hiện trước mã sẽ sinh.
  - Vai trò mới được chọn ngay. Nếu còn quyền chưa lưu thì hỏi trước.
- 375px:
  - Ô tìm bài tập chiếm cả dòng.
  - Bảng xếp thẻ trong `.card` bỏ khung card (không còn thẻ lồng thẻ).
- Test mới: phím Tabs (←/→/Home/End, roving tabIndex), Payroll/TeacherSalary `month_rate`, focus sau gán/gỡ và sau
  "Thử lại", tạo vai trò tên tiếng Việt.

## 2026-10-11 — Review fixes, vòng 6

Không có migration mới (vẫn v25).

### Tính đúng đắn / vận hành

- Boot DDL: `COMMENT` của view/function giờ lưu `boot-ddl:<hash câu lệnh>:<md5 định nghĩa>`; boot chỉ bỏ qua khi CẢ HAI
  khớp. Trước đây code cũ (sau rollback) hay hotfix psql `CREATE OR REPLACE` thân cũ mà giữ nguyên COMMENT thì bản mới
  bỏ qua, trigger audit tiền (`audit_payment`/`audit_invoice`) mất `changed_by_role`. Lần boot đầu sau nâng cấp tạo lại
  5 object một lần (tag cũ không có md5).
- `scripts/migrate-down.ts` xóa tag `boot-ddl:` sau khi rollback (lớp phòng thứ hai; DEPLOYMENT.md "Rollback").
- Chốt tháng lương chụp bảng lương trên chính transaction đang giữ lock, không mượn thêm connection từ pool (pool cạn
  vì writer xếp hàng sau lock không còn làm chốt lỗi 500).
- `GET /payroll` và `GET /teacher/payroll` thêm `avg_rate` (round(total / sessions)) và `mixed_rates` (total ≠
  sessions × per_session). `per_session` vẫn là đơn giá hiện hành — UI dùng 2 trường mới để không đặt đơn giá hiện
  hành cạnh tổng tính theo đơn giá lịch sử. Tương thích ngược (chỉ thêm trường).
- `GET /roles/users` và `members` trong `GET /roles/:id`.

### UI/UX (client)

- Phân quyền: mục "Người dùng có vai trò này" trong chi tiết role — gán/gỡ người dùng (có xác nhận), lỗi 403 hiện nguyên văn.
- Component `Tabs` chung theo WAI-ARIA (←/→/Home/End) cho Học phí, Bài tập, Đánh giá, chi tiết con; tab con lưu `?tab=`.
- Bảng danh sách ≤600px hiển thị dạng thẻ (`.table-stack` + `data-label`), hết cuộn ngang ~1250px trên điện thoại.
- Lỗi đính kèm gắn đúng ô (`aria-invalid` + `aria-describedby`); Điểm danh có "Thử lại"; Lương ẩn tổng chi khi tải lỗi.
- Tiêu đề tab không mất khi đổi ngôn ngữ; lương hiện "bình quân/buổi" khi đơn giá đổi trong tháng.
- Client 160 test, coverage 37,7% (ngưỡng CI 37/36/33/31).

## 2026-10-11 — Review fixes, vòng 5

Không có migration mới (vẫn v25).

### Tính đúng đắn / bảo mật

- `DELETE /roles/assign` gỡ được vai trò khỏi người dùng. Trước đây route bị `DELETE /roles/:id` nuốt (luôn 400
  `VALIDATION_ID`) nên API gỡ vai trò không bao giờ chạy (giao diện gán/gỡ có từ vòng 6). Test mới duyệt mọi route của app và báo route nào bị route
  đăng ký trước nuốt mất (`app.routes.test.ts`).
- Người được ủy quyền `roles.manage` không đổi được tên/mô tả của role chứa quyền mà mình không có (403, cùng kiểm tra
  như sửa quyền/xóa role).
- Chốt tháng lương và ghi dữ liệu ảnh hưởng lương (điểm danh, hủy buổi, đổi đơn giá lùi ngày) dùng chung advisory lock
  theo trung tâm: chốt chờ lần ghi đang dở commit rồi mới chụp bảng lương; lần ghi sau thấy tháng đã chốt (409). Trước
  đây một lần lưu điểm danh đúng lúc chốt có thể lọt khỏi bảng lương đã chụp.
- `POST /auth/logout-all` (`/parent/logout-all`) dùng được khi đang giữ mật khẩu tạm; token mới vẫn mang cờ
  `must_change_password`.
- Kiểm tra thu hồi token: token có `token_version` mới hơn cache của worker (đổi/đặt lại mật khẩu ở worker/instance
  khác) được đọc lại từ DB thay vì trả 401. Token cũ hơn cache vẫn bị từ chối ngay; độ trễ thu hồi tối đa giữa các
  worker vẫn là 60s (DEPLOYMENT.md).

### Vận hành

- Boot không còn `CREATE OR REPLACE VIEW`/`FUNCTION` khi định nghĩa không đổi (hash câu lệnh lưu trong `COMMENT` của
  object). Một transaction dài đang đọc `v_invoice_balance` không còn làm boot lỗi lock_timeout (vòng lặp restart PM2).
- DEPLOYMENT.md "Rollback": ghi rõ dữ liệu mất khi lùi xuống dưới v25/v24/v23 (snapshot và tháng đã chốt, lịch sử đơn
  giá — nâng cấp lại thì đơn giá áp ngược cho tháng cũ).

### UI/UX (client)

- Link đính kèm đã gõ nhưng chưa bấm "+ Thêm" được tự thêm khi lưu (URL sai → báo lỗi tại chỗ).
- Sau đăng nhập chỉ theo deep link thuộc đúng cổng của vai trò; trang giáo viên có lề ở màn hình hẹp.
- Không toast cho phiên hết hạn / bắt đổi mật khẩu (đã có UI riêng); gộp toast trùng trong 2 giây.
- Tiêu đề topbar không còn bị co ở 375px; tiêu đề tab không lặp "EduCenter Pro".
- Coverage client 13% → 37% (test trang với API giả qua `test-utils.tsx`), CI chặn khi coverage giảm.

## 2026-10-11 — Review fixes, vòng 4 (v25)

Migration **v25** `must_change_password_and_payroll_snapshot`: `users/parents.must_change_password`,
`payroll_closures.snapshot` (JSONB), thêm mốc lương `1970-01-01 = 0` cho giáo viên thiếu mốc. Xem DEPLOYMENT.md "Chuyển lên v25".

### Breaking / hành động khi nâng cấp

- Mật khẩu tạm phải đổi ngay: sau khi admin đặt lại mật khẩu, tạo tài khoản giáo viên hoặc superadmin tạo admin trung tâm,
  mọi API (trừ `GET /auth/me`, `POST /auth/change-password`, `POST /parent/change-password`) trả
  `403 PASSWORD_CHANGE_REQUIRED`. `user`/`parent` trong login, refresh và `/auth/me` có `must_change_password`.
- Lương các buổi TRƯỚC ngày hiệu lực của đơn giá đầu tiên tính 0đ (trước đây tính theo đơn giá hiện hành).

### Tính đúng đắn

- Đơn giá lương đầu tiên không áp ngược vào các tháng cũ: `PUT /payroll/rules` luôn ghi mốc `1970-01-01` (đơn giá trước
  đó, chưa có thì 0).
- Chốt tháng lương chụp bảng lương; tháng đã chốt luôn trả số đã chụp. Sửa đơn giá, điểm danh, xóa học viên/lớp sau đó
  không đổi được lương tháng đó.
- Danh sách bài của con (`GET /parent/children/:id/overview`, `homework[]`) có thêm `attempts_used` (số lượt quiz đã làm)
  bên cạnh `max_attempts`.
- v23 gắn lại `payments.credit_id` cho cả note có hậu tố `(đã hoàn lại credits)` (rollback v22 rồi nâng lại không mất liên kết).

### Bảo mật

- Người được ủy quyền `roles.manage` không còn sửa hay xóa được role đang chứa quyền mà mình không có. Trước đây họ có thể
  tước quyền của kế toán.
- Mật khẩu tạm do người khác đặt chỉ dùng để đổi mật khẩu. Người xử lý yêu cầu không dùng tiếp được tài khoản đích.

### Vận hành

- DDL lúc khởi động chỉ chạy index/cột còn thiếu (tra `pg_indexes`/`information_schema`) và chạy dưới `lock_timeout`.
  Nhờ vậy `pm2 reload` không còn giữ khóa SHARE trên khoảng 40 bảng và không còn chặn ghi khi đang có transaction dài.

### Kiến trúc

- `db/schema.ts` (1977 dòng) tách thành `schema.tables.ts`, `schema.docs.ts`, `schema.triggers.ts`, `schema.validate.ts`.
  `schema.ts` re-export các file này nên importer không đổi.
- `homework.service.ts` (1030 dòng → 650) tách thành `homework.types.ts`, `homework.input.ts` (validate input) và
  `homework.grading.ts` (chấm điểm, bảng điểm, phân tích). Nội dung chỉ di chuyển, `homework.service.ts` re-export.

### Kiểm thử

- Test mới: đơn giá đầu tiên với tháng đã chốt, bản chụp lương (gồm bản chốt cũ chưa có snapshot), DDL boot khi bảng đang bị
  giữ lock, sửa/xóa role vượt quyền, luồng mật khẩu tạm (staff + phụ huynh), cờ trên tài khoản giáo viên, `attempts_used`.

## 2026-10-11 — Review fixes, vòng 2 (v23) + nâng cấp UI/UX

Migration **v23**: `payments.credit_id`, `credits.source_invoice_id`/`voided_at`, bảng `salary_rate_history`,
index `payment_txns` (pending, invoice_id), bỏ 16 index trùng (down tạo lại).
v23 còn **sửa dữ liệu tiền**: thu hồi credit thưởng của hóa đơn đã hoàn hết (rollback không trả lại), gắn
`payments.credit_id` từ note chuẩn `Áp dụng credits #N` (cùng trung tâm). Xem DEPLOYMENT.md "Chuyển lên v23" (có query
xem trước). Migration **v24**: `homework.max_attempts` (giới hạn lượt làm quiz, 409 `MAX_ATTEMPTS`), bảng
`payroll_closures` (chốt tháng lương, 409 `PAYROLL_CLOSED`). Migration chạy với `lock_timeout` (`MIGRATION_LOCK_TIMEOUT`, mặc định 10s).

### Breaking / hành động khi nâng cấp

- `requirePermission` mặc định scope `center`; role tùy chỉnh chỉ có scope `own` sẽ bị 403 ở các route không hỗ trợ own.
- Ghi thu thủ công chỉ nhận phương thức: Tiền mặt, Chuyển khoản, Quẹt thẻ, Ví điện tử, Khác (400 với giá trị khác).
- Token không có `tv` bị coi là đã thu hồi (người dùng phải đăng nhập lại một lần).
- `METRICS_TOKEN` (tùy chọn, ≥32 ký tự) để scrape `/metrics`; mỗi mẫu có nhãn `worker`.
- Rollback: `server/scripts/migrate-down.ts --to <version> --yes` (xem DEPLOYMENT.md "Nâng cấp phiên bản").

### Bảo mật

- Gán role/đặt quyền không vượt quyền người gọi; reset mật khẩu không nhắm tài khoản cấp cao hơn; claim reset atomic.
- Khóa đăng nhập theo thiết bị (cookie HMAC, nonce + hạn 90 ngày, đổi mỗi lần đăng nhập, bucket riêng từng thiết bị):
  thiết bị đã đăng nhập không bị khóa lây khi tài khoản bị dò mật khẩu.
- Xử lý yêu cầu đặt lại mật khẩu: người xử lý phải có mọi quyền của tài khoản đích (chặn chiếm tài khoản cùng hạng có
  custom role mạnh hơn); yêu cầu pending trùng không bị ghi thêm.
- Rate limit riêng cho VNPay IPN/return, upload phụ huynh, `/api/health`.
- Quiz: ẩn đúng/sai từng câu tới `close_date`.

### Tính đúng đắn

- Hoàn tiền khôi phục credit qua `payments.credit_id`, giới hạn trong trung tâm; thu hồi thưởng giới thiệu trong cùng transaction.
- Lương tính theo đơn giá hiệu lực tại ngày buổi dạy (`PUT /payroll/rules` nhận `effective_from`).
- Không xóa học viên khi còn giao dịch VNPay đang chờ.
- Sửa lỗi boot DB v21 → v22 (index tạo trước khi cột tồn tại).

### Hiệu năng / kiến trúc

- pg-compat: chỉ ghi chạm payments/invoices (hoặc DELETE) mới mở transaction gắn actor; dịch SQL một lần.
- Báo cáo công nợ/dashboard tính đã thu theo LATERAL từng hóa đơn thay vì cộng toàn bảng.
- SQL chuyển hết khỏi route sang service; ESLint cấm import `db` trong `*.routes.ts` (trừ metrics).

### UI/UX

- Modal: focus vào ô nhập đầu tiên, không đóng khi bấm thanh cuộn, Esc an toàn khi gõ IME, bottom sheet trên mobile.
- Hỏi trước khi bỏ thay đổi chưa lưu (Esc/nền/X, reload/đóng tab và chuyển trang trong app qua data router).
- Danh sách: bỏ qua phản hồi cũ, lỗi tải có nút Thử lại, trang/tìm kiếm/bộ lọc lưu trên URL.
- Toast lỗi hiện đúng thông báo của server; ô tiền có phân cách hàng nghìn; áp credit chọn từ danh sách.
- "Tổng nợ" lấy tổng từ server; in biên lai chỉ in biên lai.
- Bản dịch tải theo nhu cầu (entry 183 KB → 50 KB); react-router 7 (npm audit: 0 lỗ hổng).

### Kiểm thử & CI

- Server 537 test, client 101 test (thêm happy-dom cho Modal/hooks/blocker); test nâng cấp DB cũ qua boot thật.
- CI: sửa build job (`NODE_ENV` chỉ ở bước smoke), thêm `npm audit --audit-level=high`.

## 2026-10-11 — Review fixes, vòng 1 (v22)

Sửa theo `docs/code-review-2026-10-10.md` (mục "Ưu tiên sửa"); migration **v22** `tenant_isolation_and_integrity`.

### Breaking / hành động khi nâng cấp

Xem quy trình đầy đủ (backup, VALIDATE, rollback) ở `docs/DEPLOYMENT.md` mục "Nâng cấp phiên bản".

- **`JWT_SECRET`** bắt buộc với mọi `NODE_ENV` trừ `development`/`test`, tối thiểu **32 ký tự** — thiếu/ngắn thì server không khởi động
  (trước đây staging/`NODE_ENV` rỗng âm thầm dùng secret công khai trong repo).
- **`APP_BASE_URL`** bắt buộc ở production (URL `https://...`, không dấu `/` cuối) — dùng cho VNPay returnUrl.
- **VNPay env đổi tên:** `VNPAY_URL`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` đã **bỏ**; thay bằng
  `VNPAY_PAY_URL` (cổng thanh toán) và `VNPAY_API_URL` (querydr cho job đối soát), mặc định sandbox, phải là `https://`.
  TMN code/hash secret nhập per-center ở trang cấu hình thanh toán; returnUrl suy ra từ `APP_BASE_URL`.
- **Bỏ `ZALO_OA_ID`/`ZALO_ACCESS_TOKEN` khỏi env** (không được dùng): cấu hình Zalo chỉ per-center trong app.
- **`UPLOAD_DIR`** (mới, mặc định `<repo>/uploads`): đưa vào backup/offsite sync — `pg_dump` không chứa file upload.
- **Không còn "trung tâm mặc định":** `reqCenterId` fail-closed — user không phải superadmin mà chưa gán trung tâm bị
  `403 NO_CENTER`. Ràng buộc `chk_users_center` (v22) ở trạng thái `NOT VALID`: phải sửa các user `center_id IS NULL` rồi
  `ALTER TABLE users VALIDATE CONSTRAINT chk_users_center;` (hourly check log ERROR `user_without_center` tới khi xong).
- **Superadmin:** thêm `?center_id=<id>` để thao tác như một trung tâm; thao tác ghi dữ liệu tenant bắt buộc chỉ rõ trung tâm
  (query/body `center_id`, thiếu → `400 CENTER_REQUIRED`) — không còn ngầm ghi vào trung tâm id nhỏ nhất.
- **API công khai** (`/public/*`): Host không khớp subdomain nào và hệ thống có nhiều trung tâm → `404` (trước đây rơi về trung tâm đầu tiên).
- **Rollback:** `server/scripts/migrate-down.ts --to <version> [--yes]` (code cũ từ chối chạy trên DB có version mới hơn).
- Node 22 là phiên bản CI/khuyến nghị.

### Bảo mật & cô lập tenant

- Chặn admin trung tâm tự cấp scope `all`/`system.*` qua custom role rồi reset mật khẩu xuyên trung tâm; scope bị hạ về `center`
  với user không phải superadmin; thay đổi role/permission được ghi audit.
- `reset_requests` và `referrals` gắn `center_id` (v22) — hết lộ username/SĐT xuyên trung tâm; referral khớp theo trung tâm.
- Liên kết con của phụ huynh (mã HV + ngày sinh) giới hạn số lần thử sai (`parent_link_failures`).
- Mã học viên unique theo trung tâm (`UNIQUE (center_id, code)`); mã role unique theo trung tâm / hệ thống (partial index).
- Service worker: không cache `/api`, `/uploads`, request có `Authorization`; cache đặt tên theo build, HTML network-first.

### Đúng đắn nghiệp vụ

- **Idempotency** viết lại: giữ chỗ nguyên tử (`processing`), khóa theo user + method + path + hash body; áp dụng cho
  tạo hóa đơn, thu tiền, hoàn tiền. Sửa lỗi `pg-compat` tự thêm `RETURNING id` vào `idempotency_keys`/`quiz_essay_scores`
  (key không bao giờ được lưu; chấm tự luận rubric lỗi 500).
- **Thanh toán/VNPay:** ký trên giá trị đúng chuẩn 2.1.0; trả dư / hóa đơn đã mất → giao dịch `needs_review` + cảnh báo, không bỏ tiền;
  job đối soát đếm `query_attempts`; hoàn tiền tách phần tiền mặt / credit rõ ràng.
- **Nhắc học phí Zalo:** sửa truy vấn hỏng (`ps.id`); `PUT /zalo/config` không ghi đè secret thật bằng chuỗi đã che.
- **Buổi học:** xóa = hủy mềm (`sessions.status='cancelled'`), lưu giáo viên thực dạy (`sessions.teacher_id`) cho bảng lương.
- **Homework/Upload:** file đính kèm đi qua sổ `uploads` (theo trung tâm, nút "Tải file lên" cho giáo viên); chỉ gắn được file
  thuộc trung tâm của người gọi hoặc đã gắn sẵn vào chính bài đó; chấm tự luận quiz theo rubric (`quiz_essay_scores`).
- **UI:** reload/tab mới không còn bị đăng xuất (refresh khi khởi động); giáo viên lưu được điểm danh; chi tiết hóa đơn hiện đúng "Đã thu";
  biên lai không còn `NaNđ`; file đính kèm của giáo viên tải được.

### Hạ tầng, test, vận hành

- Test chạy tuần tự (`--test-concurrency=1`, `TEST_OUT` riêng), glob gồm `middleware/` và `jobs/`; test fixture/`schema.test`/`upgrade.test` cập nhật cho v22.
- CI: smoke test boot thật (Postgres service, đúng cổng/env), `npm audit`, typecheck `scripts/`, prettier; Node 22.
- Backup: `pg_dump` nhận connection string nguyên vẹn (giữ `?sslmode=`), mật khẩu qua `PGPASSWORD`; thư mục backup `0700`, file dump `0600`.
- Docs: `DEPLOYMENT.md` thêm "Nâng cấp phiên bản" + rollback + PM2 logrotate/startup; sửa `API.md`/`ARCHITECTURE.md`/`CONTRIBUTING.md`/`README.md`
  (endpoint, idempotency, mẫu route, cách chạy test); `ops/GO-LIVE.md` làm mới; gộp env mẫu về `server/.env.example`.

## 2026-10-09 — Vòng "chuẩn quốc tế" (audit → fix liên tục)

- **Performance**: migration v7 thêm 18 index cho FK nóng; `getCenterSettings` batch 1 query;
  dashboard 7 query chạy song song; bảng lương viết lại 1 query `GROUP BY`.
- **Service-layer**: chuyển transaction khỏi routes (centers, roles, leads); `convertLeadToStudent` atomic.
- **API consistency**: Swagger bổ sung roles/parent refresh-logout/VNPay/metrics, sửa 17 path homework
  - path enrollments; roles envelope về raw array; `201` cho mọi endpoint tạo resource.
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

- Access token 15 phút (`ACCESS_TOKEN_TTL`; bản đầu là 1h); refresh token opaque 48-byte, 30 ngày, lưu DB dạng SHA-256 hash.
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
