import type { Db } from './connection';

interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

/**
 * Hệ thống migration có version — chuẩn production.
 *
 * - Mỗi migration chạy đúng 1 lần, được ghi vào bảng schema_migrations
 * - Idempotent: chạy lại an toàn
 * - Có thứ tự rõ ràng thay vì try/catch mù
 *
 * DB cũ (đã chạy ensureColumn kiểu cũ): các migration này dùng
 * IF NOT EXISTS / kiểm tra PRAGMA nên vẫn an toàn.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'homework_module_indexes',
    up: (_db) => {
      // Indexes đã được tạo bởi createIndexes(); migration này đánh dấu
      // các DB cũ đã "nâng cấp" lên chuẩn có index.
    },
  },
  {
    version: 2,
    name: 'homework_targets_due_date',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(homework_targets)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'due_date')) {
        db.exec('ALTER TABLE homework_targets ADD COLUMN due_date TEXT');
      }
    },
  },
  {
    version: 3,
    name: 'invoices_center_id',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(invoices)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'center_id')) {
        db.exec('ALTER TABLE invoices ADD COLUMN center_id INTEGER');
      }
    },
  },
  {
    version: 4,
    name: 'reminders_center_kind',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(reminders)').all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('center_id')) db.exec('ALTER TABLE reminders ADD COLUMN center_id INTEGER');
      if (!names.has('kind')) db.exec("ALTER TABLE reminders ADD COLUMN kind TEXT NOT NULL DEFAULT 'overdue'");
    },
  },
  {
    version: 5,
    name: 'schema_hardening_updated_at',
    up: (db) => {
      // Bản schema enterprise (schema.ts viết lại 2026-10-09) thêm cột updated_at
      // cho các bảng nghiệp vụ chính. DB cũ backfill cột tại đây; trigger +
      // view được tạo bởi createTriggers()/createViews() trong db/index.ts.
      // LƯU Ý: SQLite không ALTER để thêm FK/CHECK vào bảng đã tồn tại —
      // DB cũ giữ nguyên định nghĩa bảng cũ, chỉ DB cài mới nhận đủ ràng buộc.
      const tables = [
        'users', 'centers', 'teachers', 'students', 'classes', 'invoices',
        'parents', 'leave_requests', 'grades', 'homework',
        'trial_registrations', 'leads',
      ];
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
        if (!cols.some((c) => c.name === 'updated_at')) {
          db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`);
        }
      }
      const scols = db.prepare('PRAGMA table_info(salary_rules)').all() as { name: string }[];
      if (!scols.some((c) => c.name === 'updated_at')) {
        db.exec("ALTER TABLE salary_rules ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
      }
    },
  },
];

export function runVersionedMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  );
  const insert = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      insert.run(m.version, m.name);
    });
    tx();
  }
}
