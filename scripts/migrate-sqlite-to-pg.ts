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
 * Yêu cầu: npm install --save-dev better-sqlite3 (chỉ dùng cho script này).
 */
import Database from 'better-sqlite3';
import { Pool, types } from 'pg';

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
  'users',
  'teachers',
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
  'schema_migrations',
];

async function main(): Promise<void> {
  console.log(`[migrate] SQLite (read-only): ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
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

    for (const table of TABLE_ORDER) {
      if (!sqliteTables.has(table)) continue;
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
      if (rows.length === 0) {
        report.push({ table, sqlite: 0, pg: 0, ok: true });
        continue;
      }
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const colList = cols.map((c) => `"${c}"`).join(', ');

      // Xóa dữ liệu PG cũ của bảng này trước (trong transaction) để migrate idempotent
      await client.query(`DELETE FROM "${table}"`);

      // Insert theo batch 500 dòng
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values: unknown[] = [];
        const valueRows = batch.map((row) => {
          const ph = cols.map((c) => {
            values.push(row[c]);
            return `$${values.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        await client.query(
          `INSERT INTO "${table}" (${colList}) VALUES ${valueRows.join(', ')} ON CONFLICT DO NOTHING`,
          values
        );
      }

      // Reset sequence cho cột id (IDENTITY)
      const hasId = cols.includes('id');
      if (hasId) {
        await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), false)`);
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
