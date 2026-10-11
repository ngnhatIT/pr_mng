# Triển khai Production — EduCenterPro

## Yêu cầu

- Node.js 22 LTS (tối thiểu 20.19)
- PostgreSQL 16+
- 1GB RAM, 10GB disk

## Các bước

### 1. Cài đặt

```bash
unzip EduCenterPro-full.zip && cd educenter-pro-full
npm install
npm run build
```

### 2. Biến môi trường

Copy `server/.env.example` thành `server/.env` và điền giá trị thật. Biến bắt buộc:

```bash
DATABASE_URL=postgresql://educenter:<mat-khau-manh>@localhost:5432/educenter
JWT_SECRET="$(openssl rand -hex 32)"   # BẮT BUỘC — không đặt thì server từ chối khởi động ở production
NODE_ENV=production
PORT=4000
APP_BASE_URL=https://trungtam.example.com   # BẮT BUỘC ở production (VNPay returnUrl)
```

> Không đặt `JWT_SECRET` (tối thiểu 32 ký tự, bắt buộc mọi `NODE_ENV` trừ `development`/`test`) hoặc `APP_BASE_URL`
> ở production: server từ chối khởi động.

> **Upload:** file bài tập/bài nộp lưu ở `UPLOAD_DIR` (mặc định `<thư mục repo>/uploads`).
> Nên đặt đường dẫn tuyệt đối ngoài thư mục code, vd `UPLOAD_DIR=/var/lib/educenter/uploads`.

> **CORS:** đặt `CORS_ORIGIN` thành domain frontend production (vd: `CORS_ORIGIN=https://app.trungtam.vn`). Quên bước này, browser chặn mọi API call từ domain thật.

### 3. Chạy

```bash
npm start
# → http://localhost:4000
```

**Chạy nhiều worker (khuyến nghị production):** dùng PM2 cluster 2 worker để
tận dụng multi-core, tăng ~1,8x throughput:

```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 install pm2-logrotate    # log JSON của PM2 không tự xoay vòng — không cài sẽ phình đầy disk
pm2 startup && pm2 save      # tự chạy lại sau khi reboot máy (làm theo lệnh sudo mà pm2 startup in ra)
```

> `ecosystem.config.js` đặt `kill_timeout: 40000` (graceful shutdown chờ job tối đa 30s +
> force timer 35s) và `wait_ready` (worker báo `ready` sau khi listen) — `pm2 reload` không cắt
> ngang nhắc học phí/backup. Nhiều worker boot cùng lúc an toàn: DDL khởi tạo chạy dưới advisory lock.

> Rate-limit và permission cache là in-memory nên tách theo worker. Ở 2 worker
> chấp nhận được; scale xa hơn thì cần Redis. Các cache 60s (quyền, thu hồi token, cấu hình trung tâm)
> cũng theo từng worker — xem "Giới hạn đã biết".

Lần chạy đầu tiên tự tạo schema PostgreSQL + chạy migrations theo version.
Seed demo **mặc định TẮT** (`SEED_DEMO=false`) — chỉ bật cho môi trường dev/test.

Tài khoản superadmin khởi tạo (chạy trong thư mục `server/`):

```bash
cd server
npx tsx scripts/create-superadmin.ts <username>   # hỏi mật khẩu (ẩn ký tự), 8+ ký tự
# Không có terminal (CI/script): read -rs SUPERADMIN_PASSWORD && export SUPERADMIN_PASSWORD
```

Không truyền mật khẩu trên dòng lệnh (lộ trong shell history / `ps`). Không dùng SEED_DEMO=true trên production.

### 4. Reverse proxy (Nginx mẫu)

```nginx
server {
  listen 443 ssl;
  server_name trungtam.example.com;
  ssl_certificate /etc/ssl/cert.pem;
  ssl_certificate_key /etc/ssl/key.pem;
  # App nhận file tới 10MB — mặc định nginx 1MB sẽ trả 413 trước khi tới Express
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> Chạy sau proxy: đặt `TRUST_PROXY=true` để rate limit đọc IP thật từ `X-Forwarded-For`.

### 5. Sau khi lên production

1. **Đổi mật khẩu** các tài khoản khởi tạo ngay.
2. **Backup DB**: app đã có backup tự động (`BACKUP_CRON`, mặc định 2h sáng, giữ `BACKUP_KEEP` bản,
   có advisory lock + verify file dump sau mỗi lần backup, retry 2 lần cách 15 phút khi fail).
   **RPO 24h**: nếu DB chết lúc 18h, mất ~16h dữ liệu kể từ backup 2h sáng. Trước khi restore,
   kiểm tra timestamp bản backup mới nhất (`ls -lt backups/`) để biết phải nhập tay lại dữ liệu nào.
   Nếu backup fail cả 3 lần, chỉ có log ERROR — nên giám sát log hoặc đặt `ALERT_WEBHOOK_URL`
   (POST JSON khi backup fail).
   **Quan trọng**: backup mặc định nằm cùng disk với server (`./backups`, đã gitignored).
   Production PHẢI có bản offsite — đồng bộ thư mục backups ra S3/rclone mỗi đêm.
   **pg_dump KHÔNG chứa file upload** (ảnh/bài nộp trong `UPLOAD_DIR`) — đồng bộ cả thư mục này,
   nếu không restore xong thì bài tập/bài nộp trỏ tới file không còn:
   ```bash
   0 4 * * * rclone sync /opt/educenter/backups s3:/my-bucket/educenter-backups --min-age 1d
   30 4 * * * rclone sync /var/lib/educenter/uploads s3:/my-bucket/educenter-uploads
   ```
   Ngoài ra nên có pg_dump ra nơi khác. Dùng `~/.pgpass` (chmod 600) thay vì nhét mật khẩu vào
   connection string — mật khẩu trên dòng lệnh lộ trong `ps`; `umask 077` để dump (chứa toàn bộ PII)
   không ai khác đọc được (backup tự động của app đã ghi file 0600 trong thư mục 0700):
   ```bash
   # ~/.pgpass:  localhost:5432:educenter:educenter:<mat-khau>
   0 3 * * * umask 077; pg_dump -Fc -h localhost -U educenter -d educenter -f /backup/educenter-$(date +\%F).dump
   ```
   Drill restore hàng quý: `pg_restore --clean -d educenter_restore <file>` (xem `ops/GO-LIVE.md`).
3. **Giám sát nhất quán tài chính**: app tự chạy `checkFinancialConsistency()` mỗi giờ,
   có lệch thì log ERROR — đấu nối log này vào hệ cảnh báo (vd: Telegram/Slack webhook).
4. **VNPay production**: trong `server/.env` đặt `VNPAY_PAY_URL=https://pay.vnpay.vn/vpcpay.html`
   (trang thanh toán) và `VNPAY_API_URL=https://merchant.vnpay.vn/merchant_webapi/api/transaction`
   (API querydr cho job đối soát 15 phút) — mặc định là sandbox; phải là `https://`, production còn
   dùng sandbox thì server log cảnh báo lúc boot. `VNPAY_URL`/`VNPAY_TMN_CODE`/`VNPAY_HASH_SECRET`/`VNPAY_RETURN_URL` cũ đã bỏ. TMN code + hash secret thật nhập
   per-center ở trang `/app/cau-hinh-thanh-toan` (không đặt qua env). returnUrl lấy từ `APP_BASE_URL`.
5. **Zalo OA**: không cấu hình qua env — nhập OA ID/token per-center ở trang Zalo trong app
   (`center_settings`). Template ZNS mới cần được Zalo duyệt trước khi gửi thật (chưa cấu hình =
   chế độ demo, chỉ ghi log).

## Nâng cấp phiên bản

Migration tự chạy khi app khởi động (tuần tự theo version, dưới advisory lock — nhiều worker boot cùng lúc an toàn).
Quy trình chung cho mọi lần nâng cấp:

1. **Backup trước khi deploy** (dump + thư mục upload; xem mục Backup ở "Sau khi lên production" về `.pgpass`/`umask 077`):
   ```bash
   umask 077; pg_dump -Fc -h localhost -U educenter -d educenter -f /backup/pre-upgrade-$(date +%F).dump
   ```
2. Deploy code mới: `npm install && npm run build && pm2 reload ecosystem.config.js --env production`.
3. Kiểm tra version đã áp dụng: `SELECT max(version) FROM schema_migrations;` (v22 = `tenant_isolation_and_integrity`,
   v23 = `money_linkage_and_payroll_history`, v24 = `quiz_max_attempts_and_payroll_closures`,
   v25 = `must_change_password_and_payroll_snapshot`).
4. Làm các bước riêng của bản đó (bên dưới).

**Khóa khi migrate.** Mỗi migration chạy trong 1 transaction với `statement_timeout = 0` và `lock_timeout`
(mặc định `10s`, đổi bằng env `MIGRATION_LOCK_TIMEOUT`, vd `30s`). Nếu một transaction dài đang giữ bảng cần ALTER,
migration KHÔNG chờ vô hạn (chờ vô hạn làm mọi truy vấn khác xếp hàng sau khóa ACCESS EXCLUSIVE): nó rollback, boot
thất bại với lỗi `[MIGRATION] ... không lấy được lock bảng` và PM2 tự khởi động lại để thử tiếp. `scripts/migrate-down.ts`
dùng cùng thiết lập. **Chạy nâng cấp lúc ít tải** (v23 khóa `payments`/`credits` và bỏ 16 index trên các bảng nóng).

**DDL mỗi lần khởi động** (`createSchema`/`createIndexes`/trigger/view — chạy cả khi không có migration mới, tức mọi lần
`pm2 start/reload` hay crash-restart): chỉ chạy `CREATE INDEX` / `ADD COLUMN IF NOT EXISTS` còn **thiếu** (tra
`pg_indexes`/`information_schema`), nên lần boot bình thường không xin lock bảng nào. View/function (`CREATE OR REPLACE`)
chỉ chạy lại khi định nghĩa đổi: `COMMENT` của object lưu `boot-ddl:<hash câu lệnh>:<md5 định nghĩa>` — báo cáo/BI
đang đọc `v_invoice_balance` lâu không làm boot chờ. Bị code cũ hay hotfix psql `CREATE OR REPLACE` thân khác (COMMENT
giữ nguyên) thì md5 định nghĩa lệch -> lần boot sau tạo lại đúng bản của code. Muốn ép tạo lại: `COMMENT ON FUNCTION
<tên>() IS NULL` (hoặc `COMMENT ON VIEW`) rồi restart. Phần còn thiếu chạy cùng
`lock_timeout` như migration; bảng đang bị giữ lâu thì boot lỗi `[MIGRATION] DDL lúc khởi động: không lấy được lock bảng`
(đã rollback) và PM2 thử lại.
Lần boot đầu sau khi nâng cấp từ bản trước vòng 6 (tag cũ không có md5) tạo lại cả 5 object một lần, trong đó
`v_invoice_balance` cần ACCESS EXCLUSIVE: báo cáo/BI đang đọc view lâu sẽ làm lần boot đó lỗi lock_timeout rồi PM2 thử
lại — nâng cấp lúc ít tải hoặc dừng job BI đọc `v_invoice_balance` trước.

**Chuyển lên v23** — KHÔNG chỉ thêm bảng/cột, v23 sửa dữ liệu tiền:

- Thu hồi (void) credit thưởng giới thiệu có hóa đơn nguồn đã hoàn hết (`amount = 0`): đặt `voided_at` và
  `used_amount = amount`. `down` bỏ cột `voided_at` nhưng **không** trả lại `used_amount` — rollback không khôi phục các credit này.
- Gắn `payments.credit_id` cho payment `method='credit'` có note đúng chuẩn hệ thống `Áp dụng credits #N` và credit cùng
  trung tâm với hóa đơn. Note khác (nhân viên tự gõ) không được gắn — `checkFinancialConsistency` báo `credit_payment_unlinked`
  để kế toán xem tay (hoàn tiền các payment đó không trả lại credit).
- Bỏ 16 index trùng (`down` tạo lại).

Trước khi nâng cấp, cho kế toán xem danh sách credit sẽ bị thu hồi:

```sql
SELECT c.id, c.parent_id, c.center_id, c.amount, c.used_amount, c.reason
FROM credits c
WHERE c.reason ~ '^(Thưởng giới thiệu|Ưu đãi học viên được giới thiệu).*\(HD[0-9]+\)$'
  AND EXISTS (SELECT 1 FROM invoices i
              WHERE i.id = (substring(c.reason from '\(HD([0-9]+)\)$'))::int AND i.amount = 0);
```

**Chuyển lên v24** — chỉ thêm cột/bảng: `homework.max_attempts` (NULL = không giới hạn, quiz cũ giữ nguyên hành vi) và
`payroll_closures`. Sau khi chốt tháng lương (`POST /api/v1/payroll/closures {month}`), đổi đơn giá lùi ngày, lưu điểm
danh và hủy buổi của tháng đó trả `409 PAYROLL_CLOSED`; mở lại bằng `DELETE /api/v1/payroll/closures/:month` (có audit).

**Chuyển lên v25** — thêm cột, có 1 bước sửa dữ liệu lương:

- `users.must_change_password`, `parents.must_change_password` (mặc định `false`, tài khoản hiện có không bị ảnh hưởng).
  Từ v25, mật khẩu tạm do admin đặt lại / admin tạo tài khoản giáo viên / superadmin tạo admin trung tâm phải đổi ở lần
  đăng nhập đầu: API trả `403 PASSWORD_CHANGE_REQUIRED` tới khi đổi (client hiện màn đổi mật khẩu).
- `payroll_closures.snapshot` (JSONB): chốt tháng chụp lại bảng lương; tháng đã chốt luôn trả số đã chụp (sửa đơn giá,
  điểm danh, xóa học viên/lớp sau đó không đổi được). Tháng chốt trước v25 được chụp ở lần đầu xem bảng lương tháng đó
  sau nâng cấp. Mở lại tháng (`DELETE /payroll/closures/:month`) bỏ bản chụp; chốt lại thì chụp mới.
- Giáo viên đã có lịch sử đơn giá nhưng thiếu mốc `1970-01-01` (đơn giá đầu tiên đặt khi chưa có đơn giá nào) được thêm
  mốc `1970-01-01 = 0`: các buổi TRƯỚC ngày hiệu lực của đơn giá đầu tiên tính 0đ (trước đây bị tính theo đơn giá hiện
  hành — sai, làm đổi cả tháng đã chốt). Xem trước các giáo viên bị ảnh hưởng:

  ```sql
  SELECT h.teacher_id, MIN(h.effective_from) AS first_rate_from FROM salary_rate_history h
  GROUP BY h.teacher_id HAVING MIN(h.effective_from) > '1970-01-01';
  ```

  `down` của v25 giữ các mốc này (đúng với dữ liệu v24), chỉ bỏ cột mới.

**Chuyển lên v22 (review 2026-10-10)** — thêm ràng buộc `chk_users_center` ở trạng thái `NOT VALID`: dòng mới/sửa
bị kiểm, dòng cũ chưa bị kiểm nên app vẫn boot. Tài khoản không phải superadmin mà `center_id IS NULL` sẽ bị
`403 NO_CENTER` khi đăng nhập/gọi API (không còn rơi về "toàn hệ thống" hay trung tâm đầu tiên). Cần sửa rồi VALIDATE:

```sql
-- 1. Liệt kê dòng vi phạm (app cũng log ERROR 'user_without_center' mỗi giờ qua checkFinancialConsistency)
SELECT id, username, role, teacher_id, is_active FROM users WHERE role <> 'superadmin' AND center_id IS NULL;

-- 2. Giáo viên: lấy trung tâm từ hồ sơ giáo viên (nếu có)
UPDATE users u SET center_id = t.center_id FROM teachers t
 WHERE u.teacher_id = t.id AND u.center_id IS NULL AND u.role <> 'superadmin';

-- 3. Còn lại: gán trung tâm đúng cho từng tài khoản (hoặc DELETE nếu là tài khoản rác).
--    Chỉ khóa (is_active = false) là CHƯA ĐỦ: dòng vẫn vi phạm ràng buộc, VALIDATE sẽ lỗi.
UPDATE users SET center_id = <id_trung_tam> WHERE id = <id_user>;

-- 4. Khi bước 1 không còn dòng nào: kiểm tra toàn bảng
ALTER TABLE users VALIDATE CONSTRAINT chk_users_center;

-- 5. Xác nhận (convalidated = t)
SELECT convalidated FROM pg_constraint WHERE conname = 'chk_users_center';
```

Ghi chú: `reset_requests` có `center_id IS NULL` (không xác định được trung tâm lúc backfill, vd SĐT phụ huynh trùng giữa
2 trung tâm) chỉ superadmin thấy và xử lý được; admin trung tâm không thấy các yêu cầu đó.

### Rollback

`runMigrations` từ chối khởi động code cũ trên DB có version mới hơn code, nên lùi release sau khi đã migrate phải
rollback schema trước. Cách an toàn nhất vẫn là **restore từ bản pg_dump trước khi nâng cấp** (mất dữ liệu ghi sau đó).
Nếu chỉ cần lùi schema, dùng script (trong `server/`, đọc `DATABASE_URL` từ `server/.env`):

```bash
cd server
npx tsx scripts/migrate-down.ts --to 22          # dry-run: in kế hoạch (gỡ v25, v24, v23), KHÔNG thay đổi gì
npx tsx scripts/migrate-down.ts --to 21 --yes    # thực hiện: chạy down của mọi migration > 21 (v25 → v22), mới nhất trước
```

- `--to <version>` là version GIỮ LẠI (lùi hẳn v22 về v21: `--to 21`; chỉ gỡ v23: `--to 22`). Phải có `--yes` mới chạy thật.
- Dừng app và pg_dump trước khi chạy: `down` xóa cột/bảng mới (vd v22 bỏ `uploads`, `sessions.status`, `center_id` của
  `reset_requests`/`referrals`) và có thể lỗi khi khôi phục unique toàn cục nếu hai trung tâm đã dùng trùng mã học viên/role.
- Từ chối chạy nếu migration cần gỡ chưa có `down` (v2–v13, v15): restore từ pg_dump.
- **Mất dữ liệu lương / bảo mật khi lùi qua v25–v23** (nâng cấp lại KHÔNG lấy lại được — muốn giữ thì restore pg_dump):
  - xuống dưới **v25**: mất `payroll_closures.snapshot` (tháng đã chốt sẽ tính lại từ dữ liệu hiện tại, rồi chụp lại ở
    lần đọc đầu) và cờ `must_change_password` (tài khoản đang giữ mật khẩu tạm dùng được ngay, không bị buộc đổi);
  - xuống dưới **v24**: mất bảng `payroll_closures` (mọi tháng đã chốt thành MỞ, sửa đơn giá/điểm danh được lại) và
    `homework.max_attempts` (quiz về không giới hạn lượt);
  - xuống dưới **v23**: mất `salary_rate_history` — nâng cấp lại, v23 backfill mốc `1970-01-01` = đơn giá **hiện tại**,
    nên đơn giá đầu tiên/đổi giá áp NGƯỢC cho mọi tháng cũ (lương tháng cũ thay đổi); mất cả `payments.credit_id` /
    `credits.voided_at` (v23 gắn lại credit theo note khi nâng cấp lại, payment note tự gõ không gắn lại được).
- Mỗi migration chạy trong 1 transaction và xóa dòng tương ứng trong `schema_migrations`; lỗi thì dừng tại đó.
- Xong rollback, script xóa tag `boot-ddl:` trong `COMMENT` của view/function: bản cũ tạo lại thân cũ, nâng cấp lại thì
  boot tạo lại toàn bộ (vd trigger audit tiền ghi lại `changed_by_role`).
- Sau đó deploy lại code của version tương ứng.

## Tính năng vận hành đã có

- **Audit log**: mọi thao tác tiền bạc và xóa quan trọng được ghi `audit_logs` (xem `/app/nhat-ky`).
- **Backup tự động**: theo lịch cron trong app.
- **Health check**: `GET /api/live` (liveness), `GET /api/health` (public, có ping DB), `GET /api/v1/health` (chi tiết, chỉ superadmin).
- **Metrics**: `GET /api/v1/metrics` (Prometheus, chỉ superadmin).
- **Job nền**: sinh buổi học 00:15 hằng ngày (trước 90 ngày), dọn file upload mồ côi mỗi giờ (file > 24h không
  được tham chiếu), đối soát VNPay 15 phút, kiểm tra nhất quán tài chính mỗi giờ, backup theo `BACKUP_CRON`.
- **Rate limiting**: login 10 req/60s/IP (+ giới hạn riêng theo tài khoản);
  API chung theo tài khoản (IP nếu chưa đăng nhập): GET đã đăng nhập 1500 req/15ph, còn lại 300 req/15ph;
  cổng phụ huynh GET 1000 / còn lại 200; thao tác ghi có trần riêng
  (xem `server/src/middleware/rateLimit.ts`).
  Mọi giới hạn đều tính **per-worker**: với PM2 cluster N worker, đặt
  `RATE_LIMIT_DIVISOR=N` (ecosystem.config.js đã đặt 2) để tổng toàn cụm
  không vượt max cấu hình.

## Giới hạn đã biết

- Rate limiter và event bus dùng bộ nhớ trong (in-memory): phù hợp chạy 1 instance.
  Khi scale multi-instance, cần thay bằng Redis. Với PM2 cluster, quota
  rate-limit được chia đều cho các worker qua `RATE_LIMIT_DIVISOR`
  (tổng toàn cụm = max cấu hình).
- Cache theo process (không có invalidation chéo worker): quyền/role, kiểm tra thu hồi token (`token_version`) và cấu hình
  trung tâm (gồm khóa VNPay) đều là Map 60s trong từng worker. Khóa giáo viên, đổi role hay xoay secret VNPay có thể
  mất tới 60s mới có hiệu lực trên worker còn lại. Hướng nâng cấp: pg `LISTEN/NOTIFY` để xóa cache (`pg` đã có sẵn).
  Thu hồi token (đổi/đặt lại mật khẩu, logout-all): token cũ có thể còn dùng được **tối đa 60s** trên worker/instance
  khác; token MỚI (tv lớn hơn cache) không bao giờ bị từ chối — worker thấy tv mới hơn thì đọc lại DB.
