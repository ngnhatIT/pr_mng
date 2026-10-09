import type { Db, Tx } from './pg-compat';
import { SCHEMA_VERSION } from './schema';

/**
 * Migration PostgreSQL — chạy tuần tự theo version, mỗi migration trong
 * 1 transaction riêng, ghi nhận vào schema_migrations.
 *
 * - DB mới: schema.ts đã là trạng thái đích; migration vẫn chạy (idempotent)
 *   để mọi môi trường hội tụ cùng trạng thái.
 * - DB cũ: chỉ chạy các migration chưa ghi nhận.
 * - Fail-fast nếu version trong DB lớn hơn code (DB được migrate bởi bản
 *   code mới hơn — từ chối chạy để tránh ghi đè).
 *
 * Không tái sử dụng migration SQLite cũ (khác engine). Chuyển dữ liệu từ
 * SQLite cũ (nếu có): xem scripts/migrate-sqlite-to-pg.ts.
 */

interface Migration {
  version: number;
  name: string;
  up: (tx: Tx) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'reminder_kinds',
    up: async (tx) => {
      // Mở rộng danh sách kind cho reminders (scheduler/Zalo/bài tập/điểm dùng
      // các kind mới nhưng constraint cũ chỉ cho phép 3 giá trị -> INSERT lỗi).
      await tx.exec('ALTER TABLE reminders DROP CONSTRAINT IF EXISTS chk_reminders_kind');
      // DO block để idempotent: DB mới tạo từ schema.ts đã có constraint mới.
      await tx.exec(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'chk_reminders_kind' AND conrelid = 'reminders'::regclass
          ) THEN
            ALTER TABLE reminders ADD CONSTRAINT chk_reminders_kind CHECK (
              kind IN ('overdue','upcoming','receipt','test','absence','leave_result',
                       'payment_confirmed','grade','homework','general')
            );
          END IF;
        END $$;`);
      // Thêm trạng thái 'sending': log được ghi TRƯỚC khi gọi ZNS để chống gửi trùng khi crash.
      await tx.exec('ALTER TABLE reminders DROP CONSTRAINT IF EXISTS chk_reminders_status');
      await tx.exec(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'chk_reminders_status' AND conrelid = 'reminders'::regclass
          ) THEN
            ALTER TABLE reminders ADD CONSTRAINT chk_reminders_status CHECK (
              status IN ('sending', 'sent', 'failed', 'demo')
            );
          END IF;
        END $$;`);
    },
  },
  {
    version: 3,
    name: 'reviews_parent_unique',
    up: async (tx) => {
      // Mỗi phụ huynh chỉ có 1 đánh giá đang hiệu lực mỗi trung tâm
      // (parent_id NULL = đánh giá ẩn danh, không áp unique).
      await tx.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS parent_reviews_unique ON reviews(parent_id, center_id) WHERE parent_id IS NOT NULL'
      );
    },
  },
  {
    version: 4,
    name: 'history_changed_by',
    up: async (tx) => {
      // Lưới an toàn: cột changed_by đã có trong schema.ts hiện tại, nhưng DB
      // tạo từ bản schema cũ hơn có thể thiếu -> thêm nếu chưa có.
      // (runMigrations chạy TRƯỚC createHistoryTables nên bảng có thể chưa tồn
      // tại trên DB hoàn toàn mới -> kiểm tra tồn tại trước.)
      for (const t of ['payment_history', 'invoice_history']) {
        const exists = await tx
          .prepare("SELECT 1 AS ok FROM pg_tables WHERE schemaname = 'public' AND tablename = ?")
          .get(t);
        if (exists) {
          await tx.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS changed_by INTEGER`);
        }
      }
    },
  },
  {
    version: 5,
    name: 'refresh_tokens',
    up: async (tx) => {
      // Bảng refresh token cho cơ chế rotation (access token rút ngắn còn 1 giờ).
      // DB mới đã có từ schema.ts -> CREATE TABLE IF NOT EXISTS an toàn cả 2 đường.
      await tx.exec(`CREATE TABLE IF NOT EXISTS refresh_tokens (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES parents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CONSTRAINT chk_refresh_kind CHECK (kind IN ('staff', 'parent')),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        replaced_by TEXT,
        ip TEXT,
        user_agent TEXT,
        CONSTRAINT chk_refresh_owner CHECK (
          (user_id IS NOT NULL AND parent_id IS NULL) OR
          (user_id IS NULL AND parent_id IS NOT NULL)
        )
      )`);
      await tx.exec(
        'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_owner ON refresh_tokens(user_id, parent_id)'
      );
    },
  },
  {
    version: 6,
    name: 'payments_refund_negative',
    up: async (tx) => {
      // Cho phép hoàn tiền: amount âm khi method='refund' (bản ghi hoàn tiền trừ vào công nợ).
      // DB mới đã có constraint mới từ schema.ts -> DROP/CREATE an toàn cả 2 đường.
      await tx.exec('ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_amount');
      await tx.exec(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'chk_payments_amount' AND conrelid = 'payments'::regclass
          ) THEN
            ALTER TABLE payments ADD CONSTRAINT chk_payments_amount
              CHECK (amount > 0 OR (amount < 0 AND method = 'refund'));
          END IF;
        END $$;`);
    },
  },
  {
    version: 7,
    name: 'hot_fk_indexes',
    up: async (tx) => {
      // Index cho các FK nóng (audit performance 2026-10-09): PostgreSQL không
      // tự index FK. DB mới đã có từ schema.ts -> IF NOT EXISTS an toàn cả 2 đường.
      const idx = [
        'CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_students_center ON students(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_classes_center ON classes(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_teachers_center ON teachers(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_homework_center ON homework(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id)',
        'CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_homework ON quiz_attempts(homework_id)',
        'CREATE INDEX IF NOT EXISTS idx_submissions_homework_student ON homework_submissions(homework_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_leave_requests_student ON leave_requests(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)',
        'CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_students_center ON students(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_classes_center ON classes(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_teachers_center ON teachers(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_homework_center ON homework(center_id)',
        'CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id)',
        'CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_homework ON quiz_attempts(homework_id)',
        'CREATE INDEX IF NOT EXISTS idx_submissions_homework_student ON homework_submissions(homework_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_leave_requests_student ON leave_requests(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)',
        'CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_id)',
        'CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_checkins_session ON teacher_checkins(session_id)',
        'CREATE INDEX IF NOT EXISTS idx_checkins_teacher ON teacher_checkins(teacher_id)',
      ];
      for (const sql of idx) await tx.exec(sql);
    },
  },
  {
    version: 8,
    name: 'idempotency_keys',
    up: async (tx) => {
      // Bảng idempotency key: chống double-submit tạo dữ liệu trùng.
      // Client gửi header Idempotency-Key (UUID); server trả lại kết quả cũ nếu key đã dùng.
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          user_id INTEGER,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          response_body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
        )
      `);
      await tx.exec('CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at)');
    },
  },
  {
    version: 9,
    name: 'hot_table_indexes_2',
    up: async (tx) => {
      // 4 index còn thiếu trên bảng nóng (audit API perf 2026-10-09)
      const idx = [
        'CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id)',
        'CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(class_id)',
      ];
      for (const sql of idx) await tx.exec(sql);
    },
  },
  {
    version: 10,
    name: 'teacher_checkin_salary_indexes',
    up: async (tx) => {
      // Index cho teacher schedule EXISTS + payroll salary_rules lookup (audit API perf 2)
      const idx = [
        'CREATE INDEX IF NOT EXISTS idx_teacher_checkins_lookup ON teacher_checkins(teacher_id, session_id)',
        'CREATE INDEX IF NOT EXISTS idx_salary_rules_teacher ON salary_rules(teacher_id)',
      ];
      for (const sql of idx) await tx.exec(sql);
    },
  },
  {
    version: 11,
    name: 'audit_logs_indexes',
    up: async (tx) => {
      // Index cho audit_logs (truy vấn theo center + thời gian)
      const idx = [
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_center ON audit_logs(center_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id)',
      ];
      for (const sql of idx) await tx.exec(sql);
    },
  },
  {
    version: 12,
    name: 'credits_center_id',
    up: async (tx) => {
      // Credits phải gắn với center để không áp chéo trung tâm
      await tx.exec('ALTER TABLE credits ADD COLUMN IF NOT EXISTS center_id INTEGER');
      // Backfill: lấy center từ referral đầu tiên của parent (nếu có)
      await tx.exec(`
        UPDATE credits c SET center_id = (
          SELECT s.center_id FROM referrals r
          JOIN students s ON s.id = r.referred_student_id
          WHERE r.referrer_parent_id = c.parent_id AND r.status = 'rewarded'
          ORDER BY r.id ASC LIMIT 1
        ) WHERE c.center_id IS NULL
      `);
    },
  },
  {
    version: 13,
    name: 'reviews_unique_parent_center',
    up: async (tx) => {
      // 1 review / parent / center — chống race tạo trùng
      await tx.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS parent_reviews_unique ON reviews(parent_id, center_id)'
      );
    },
  },
  {
    version: 14,
    name: 'reviews_unique_fix_partial',
    up: async (tx) => {
      // v13 bị dead code: tên index trùng với partial index của v3 (WHERE parent_id IS NOT NULL)
      // nên IF NOT EXISTS luôn no-op trên DB cũ. Drop partial rồi tạo full unique index.
      await tx.exec('DROP INDEX IF EXISTS parent_reviews_unique');
      await tx.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS parent_reviews_unique_full ON reviews(parent_id, center_id)'
      );
    },
  },
];

/** Version migration cao nhất mà code hiện tại biết (để test đối chiếu). */
export const LATEST_MIGRATION_VERSION: number = Math.max(...MIGRATIONS.map((m) => m.version));

const CODE_VERSION = Math.max(SCHEMA_VERSION, LATEST_MIGRATION_VERSION);

export async function runMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
  )`);

  const r = await db.query('SELECT version FROM schema_migrations');
  const applied = new Set((r.rows as { version: number }[]).map((row) => Number(row.version)));

  // Fail-fast: DB đã được migrate bởi code mới hơn -> từ chối chạy.
  const dbMax = applied.size > 0 ? Math.max(...applied) : 0;
  if (dbMax > CODE_VERSION) {
    throw new Error(
      `[MIGRATION] DB schema version ${dbMax} mới hơn code (${CODE_VERSION}) — từ chối khởi động để tránh ghi đè`
    );
  }

  // Baseline cho DB hoàn toàn mới (giữ tương thích với bản stub trước đây).
  if (applied.size === 0) {
    await db.query(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?) ON CONFLICT (version) DO NOTHING',
      [SCHEMA_VERSION, 'pg_baseline']
    );
    applied.add(SCHEMA_VERSION);
  }

  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    // Advisory lock chống 2 instance chạy migration song song (rolling deploy).
    // Lock giữ trong transaction → tự release khi commit/rollback.
    await db.transaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('educenter-migrations'))");
      await m.up(tx);
      await tx
        .prepare(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?) ON CONFLICT (version) DO NOTHING'
        )
        .run(m.version, m.name);
    });
    applied.add(m.version);
  }
}
