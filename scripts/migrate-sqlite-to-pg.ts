/**
 * Migrate dữ liệu từ SQLite cũ (better-sqlite3) sang PostgreSQL.
 *
 * Cách dùng:
 *   npx tsx scripts/migrate-sqlite-to-pg.ts --sqlite ./server/data.db --pg postgres://user:pass@host:5432/db
 *
 * Hoặc dùng biến môi trường:
 *   SQLITE_PATH=./server/data.db DATABASE_URL=postgres://... npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Nguyên tắc an toàn:
 * - Chỉ ĐỌC SQLite (mở read-only), không bao giờ ghi/xóa file SQLite.
 * - Ghi vào PostgreSQL trong 1 transaction duy nhất — lỗi thì rollback toàn bộ.
 * - Giữ nguyên id các bảng (để FK không gãy), sau đó reset sequence (IDENTITY).
 * - Cuối cùng đối chiếu số dòng từng bảng SQLite vs PostgreSQL.
 *
 * - Cột thời điểm (`*_at`): SQLite cũ lưu UTC (datetime('now')), PG lưu giờ VN
 *   (Asia/Ho_Chi_Minh) -> đổi +7h khi copy (DATA-15). Cột chỉ có ngày giữ nguyên.
 * - Không TRUNCATE CASCADE (từng xóa sạch roles/role_permissions/user_roles/refresh_tokens
 *   — DATA-22): DELETE từng bảng theo thứ tự ngược FK, roles hệ thống được giữ.
 * - schema_migrations của PG KHÔNG bị ghi đè (version SQLite khác nghĩa version PG).
 *
 * Yêu cầu (KHÔNG có sẵn trong repo — cài riêng trước khi chạy):
 *   npm i -D better-sqlite3 @types/better-sqlite3
 */
import { Pool, types } from 'pg';
import { utcToVnText } from '../server/src/db/date-utils';

async function openSqlite(path: string): Promise<{
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}> {
  try {
    // Import động: better-sqlite3 không nằm trong dependencies của repo.
    const mod = 'better-sqlite3';
    const { default: Database } = await import(mod);
    return new Database(path, { readonly: true });
  } catch (e) {
    console.error('[migrate] Thiếu better-sqlite3. Cài trước: npm i -D better-sqlite3 @types/better-sqlite3');
    throw e;
  }
}

// BIGINT -> number (đồng nhất với pg-compat.ts)
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SQLITE_PATH = arg('sqlite') || process.env.SQLITE_PATH;
const PG_URL = arg('pg') || process.env.DATABASE_URL;

if (!SQLITE_PATH || !PG_URL) {
  console.error('Thiếu tham số. Dùng: --sqlite <path> --pg <url> (hoặc SQLITE_PATH / DATABASE_URL)');
  process.exit(1);
}

/**
 * Thứ tự bảng theo FK (cha trước con sau). Bảng nào không có trong SQLite
 * thì bỏ qua. payment_history / invoice_history là immutable log — migrate
 * sau cùng để giữ nguyên lịch sử.
 */
const TABLE_ORDER = [
  'centers',
  // teachers trước users: users.teacher_id FK -> teachers
  'teachers',
  'users',
  'center_settings',
  'settings',
  'students',
  'rooms',
  'classes',
  'enrollments',
  'sessions',
  'attendance',
  'teacher_checkins',
  'salary_rules',
  'parents',
  'parent_students',
  'credits',
  'invoices',
  'payments',
  'payment_txns',
  'leave_requests',
  'grades',
  'homework',
  'homework_attachments',
  'homework_targets',
  'homework_completions',
  'homework_scores',
  'homework_submissions',
  'rubrics',
  'rubric_criteria',
  'quiz_questions',
  'quiz_options',
  'quiz_attempts',
  'quiz_answers',
  'question_bank',
  'question_bank_options',
  'trial_registrations',
  'leads',
  'reminders',
  'reviews',
  'referrals',
  'audit_logs',
  // immutable history sau cùng
  'payment_history',
  'invoice_history',
];

async function main(): Promise<void> {
  console.log(`[migrate] SQLite (read-only): ${SQLITE_PATH}`);
  const sqlite = await openSqlite(SQLITE_PATH as string);
  const pg = new Pool({ connectionString: PG_URL, max: 5 });

  // Kiểm tra PG đã có schema chưa (bảng centers phải tồn tại)
  const check = await pg.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'centers'`);
  if (check.rows.length === 0) {
    console.error('[migrate] PostgreSQL chưa có schema. Hãy chạy server 1 lần (initDatabase) trước khi migrate.');
    process.exit(1);
  }

  const sqliteTables = new Set(
    (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name)
  );

  const report: { table: string; sqlite: number; pg: number; ok: boolean }[] = [];
  const client = await pg.connect();
  try {
    await client.query('BEGIN');

    // Trigger audit sẽ tự sinh payment_history/invoice_history khi DELETE/INSERT ->
    // trùng với lịch sử copy từ SQLite. Tắt trong transaction (DDL PG có transaction,
    // lỗi thì ROLLBACK tự bật lại); bật lại trước COMMIT.
    await client.query('ALTER TABLE payments DISABLE TRIGGER trg_payments_audit');
    await client.query('ALTER TABLE invoices DISABLE TRIGGER trg_invoices_audit');

    // Xóa dữ liệu PG cũ cho các bảng sẽ migrate (để chạy lại an toàn): DELETE con trước
    // cha sau. KHÔNG TRUNCATE ... CASCADE — nó xóa trọn mọi bảng tham chiếu (roles,
    // role_permissions, user_roles, refresh_tokens) mà script không nạp lại.
    // Chỉ xóa bảng tồn tại ở cả 2 phía để không làm hỏng schema PG thiếu bảng.
    const pgTables = new Set(
      (
        await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
      ).rows.map((r: { tablename: string }) => r.tablename)
    );
    const toClear = TABLE_ORDER.filter((t) => sqliteTables.has(t) && pgTables.has(t));
    for (const t of [...toClear].reverse()) await client.query(`DELETE FROM "${t}"`);

    for (const table of TABLE_ORDER) {
      if (!sqliteTables.has(table)) continue;
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
      if (rows.length === 0) {
        report.push({ table, sqlite: 0, pg: 0, ok: true });
        continue;
      }
      const cols = Object.keys(rows[0]);
      const tsCols = new Set(cols.filter((c) => c.endsWith('_at')));
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');

      // Insert theo batch 500 dòng
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values: unknown[] = [];
        const valueRows = batch.map((row) => {
          const ph = cols.map((c) => {
            values.push(tsCols.has(c) ? utcToVnText(row[c]) : row[c]);
            return `$${values.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        await client.query(
          `INSERT INTO "${table}" (${colList}) VALUES ${valueRows.join(', ')} ON CONFLICT DO NOTHING`,
          values
        );
      }

      // Reset sequence cho cột id (IDENTITY). setval(..., true): nextval() tiếp
      // theo trả về MAX(id)+1 — dùng false sẽ trả về đúng MAX(id) gây trùng PK
      // ở INSERT đầu tiên sau migrate.
      const hasId = cols.includes('id');
      if (hasId) {
        await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`);
      }

      const pgCount = await client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
      const ok = pgCount.rows[0].c === rows.length;
      report.push({ table, sqlite: rows.length, pg: pgCount.rows[0].c, ok });
      console.log(`[migrate] ${table}: sqlite=${rows.length} pg=${pgCount.rows[0].c} ${ok ? 'OK' : 'LỆCH!'}`);
    }

    const failed = report.filter((r) => !r.ok);
    if (failed.length > 0) {
      await client.query('ROLLBACK');
      console.error(`[migrate] ROLLBACK — ${failed.length} bảng lệch số dòng: ${failed.map((f) => f.table).join(', ')}`);
      process.exit(1);
    }

    await client.query('ALTER TABLE payments ENABLE TRIGGER trg_payments_audit');
    await client.query('ALTER TABLE invoices ENABLE TRIGGER trg_invoices_audit');
    await client.query('COMMIT');
    console.log('[migrate] COMMIT thành công.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pg.end();
    sqlite.close();
  }

  const total = report.reduce((s, r) => s + r.pg, 0);
  console.log(`[migrate] Hoàn tất: ${report.length} bảng, ${total} dòng. SQLite gốc không bị thay đổi.`);
}

main().catch((e) => {
  console.error('[migrate] LỖI:', e.message);
  process.exit(1);
});
