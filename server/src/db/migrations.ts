import type { Db } from './pg-compat';
import { SCHEMA_VERSION } from './schema';

/**
 * Migration PostgreSQL — baseline mới, đánh số lại từ 1.
 *
 * Không tái sử dụng migration SQLite cũ (khác engine). DB PostgreSQL luôn
 * được tạo từ schema.ts hiện tại; bảng schema_migrations chỉ ghi nhận
 * version baseline để các migration tăng dần trong tương lai có điểm tựa.
 *
 * Chuyển dữ liệu từ SQLite cũ (nếu có): xem scripts/migrate-sqlite-to-pg.ts.
 */
export async function runMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
  )`);
  const r = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
  const current = ((r.rows[0] as { version?: number } | undefined)?.version ?? 0) as number;
  if (current < SCHEMA_VERSION) {
    await db.query('INSERT INTO schema_migrations (version, name) VALUES (?, ?) ON CONFLICT (version) DO NOTHING', [
      SCHEMA_VERSION,
      'pg_baseline',
    ]);
  }
}
