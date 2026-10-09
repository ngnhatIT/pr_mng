import { Pool, PoolClient, types } from 'pg';
import dotenv from 'dotenv';

// Nạp .env (nếu có) trước khi đọc DATABASE_URL — dev tiện, production dùng env thật.
dotenv.config();

// PostgreSQL trả BIGINT (OID 20, ví dụ COUNT(*)) dạng string để tránh mất precision.
// App này dùng COUNT cho pagination — ép về number cho đồng nhất với SQLite cũ.
// (Giá trị > Number.MAX_SAFE_INTEGER không xảy ra với COUNT trong app này.)
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/**
 * PostgreSQL connection + lớp tương thích API cho codebase.
 *
 * Codebase được viết theo phong cách better-sqlite3 (đồng bộ):
 *   db.prepare('SELECT * FROM users WHERE id = ?').get(id)
 *
 * PostgreSQL là async, nên lớp này giữ nguyên HÌNH DẠNG gọi hàm
 * (prepare/get/all/run/exec/transaction) nhưng trả về Promise —
 * mỗi call-site chỉ cần thêm `await`, không phải viết lại SQL.
 *
 * Tự động dịch các khác biệt dialect SQLite -> PostgreSQL:
 *  - `?`                  -> `$1, $2, ...` (nhận biết string literal)
 *  - `datetime('now')`    -> `to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')`
 *                           (giữ TEXT ISO như SQLite để so sánh chuỗi vẫn đúng)
 *  - `datetime('now','-3 days')` -> `to_char(NOW() + INTERVAL '-3 days', ...)`
 *  - `date('now')`        -> `to_char(NOW(), 'YYYY-MM-DD')`
 *  - `INSERT OR IGNORE INTO t ...` -> `INSERT INTO t ... ON CONFLICT DO NOTHING`
 *  - `LIKE`               -> `ILIKE` (SQLite LIKE không phân biệt hoa thường)
 *  - `json_object(`       -> `json_build_object(`
 *
 * Cấu hình: DATABASE_URL (vd: postgres://user:pass@localhost:5432/educenter)
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

pool.on('error', (err) => {
  // Pool error không crash app, nhưng phải thấy được trong log
  // eslint-disable-next-line no-console
  console.error('[pg pool error]', err.message);
});

/* ------------------------- Dịch SQL SQLite -> PG ------------------------- */

/** Đổi `?` thành `$n`, bỏ qua `?` nằm trong string literal / comment. */
function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const ch = sql[i];
    // string literal '...'
    if (ch === "'") {
      out += ch;
      i++;
      while (i < len) {
        out += sql[i];
        if (sql[i] === "'") {
          // '' escape
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // quoted identifier "..."
    if (ch === '"') {
      out += ch;
      i++;
      while (i < len && sql[i] !== '"') {
        out += sql[i];
        i++;
      }
      if (i < len) {
        out += sql[i];
        i++;
      }
      continue;
    }
    // line comment --
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < len && sql[i] !== '\n') {
        out += sql[i];
        i++;
      }
      continue;
    }
    // block comment /* */
    if (ch === '/' && sql[i + 1] === '*') {
      out += '/*';
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i];
        i++;
      }
      if (i < len) {
        out += '*/';
        i += 2;
      }
      continue;
    }
    if (ch === '?') {
      n++;
      out += `$${n}`;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function translateSqlite(sql: string): string {
  const TS_FMT = `'YYYY-MM-DD HH24:MI:SS'`;
  let s = sql;
  // datetime('now', '<modifier>') -> to_char(NOW() + INTERVAL '<modifier>', ...)
  s = s.replace(/datetime\('now',\s*'([^']+)'\)/gi, `to_char(NOW() + INTERVAL '$1', ${TS_FMT})`);
  // datetime('now') -> to_char(NOW(), ...)
  s = s.replace(/datetime\('now'\)/gi, `to_char(NOW(), ${TS_FMT})`);
  // date('now') -> to_char(NOW(), 'YYYY-MM-DD')
  s = s.replace(/date\('now'\)/gi, `to_char(NOW(), 'YYYY-MM-DD')`);
  // json_object( -> json_build_object(
  s = s.replace(/json_object\(/gi, 'json_build_object(');
  // LIKE -> ILIKE (giữ nguyên ý nghĩa tìm kiếm không phân biệt hoa thường)
  s = s.replace(/\bLIKE\b/gi, 'ILIKE');
  // INSERT OR IGNORE INTO t ... -> INSERT INTO t ... ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+OR\s+IGNORE\s+/i.test(s)) {
    s = s.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    // bỏ RETURNING tạm nếu có để gắn ON CONFLICT trước nó
    const retMatch = s.match(/\sRETURNING\s+.*$/i);
    let returning = '';
    if (retMatch) {
      returning = retMatch[0];
      s = s.slice(0, retMatch.index);
    }
    s = s.trimEnd() + ' ON CONFLICT DO NOTHING' + returning;
  }
  return toPgPlaceholders(s);
}

/* ------------------------------ Statement API ---------------------------- */

export interface RunResult {
  changes: number;
  lastInsertRowid: number | undefined;
}

export interface Statement {
  get(...params: unknown[]): Promise<unknown>;
  all(...params: unknown[]): Promise<unknown[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;

/** Bảng không có cột id (khóa chính composite) — không RETURNING id được. */
const NO_ID_TABLES = new Set(['center_settings', 'settings', 'salary_rules', 'payment_txns', 'parent_students', 'homework_targets', 'homework_scores', 'quiz_answers', 'role_permissions', 'user_roles']);

function makeStatement(queryFn: QueryFn, sql: string): Statement {
  let pgSql = translateSqlite(sql);
  // INSERT tự động lấy id về (thay cho better-sqlite3 lastInsertRowid).
  // Bỏ qua nếu SQL đã có RETURNING hoặc insert vào bảng không có cột id.
  if (/^\s*INSERT\b/i.test(pgSql) && !/\bRETURNING\b/i.test(pgSql)) {
    const m = pgSql.match(/^\s*INSERT\s+INTO\s+("?\w+"?)/i);
    const table = (m?.[1] ?? '').replace(/"/g, '').toLowerCase();
    if (!NO_ID_TABLES.has(table)) {
      pgSql = pgSql.trimEnd().replace(/;$/, '') + ' RETURNING id';
    }
  }
  return {
    async get(...params: unknown[]): Promise<unknown> {
      const r = await queryFn(pgSql, params);
      return r.rows[0] ?? undefined;
    },
    async all(...params: unknown[]): Promise<unknown[]> {
      const r = await queryFn(pgSql, params);
      return r.rows;
    },
    async run(...params: unknown[]): Promise<RunResult> {
      const r = await queryFn(pgSql, params);
      const first = r.rows[0] as { id?: number } | undefined;
      return {
        changes: r.rowCount ?? 0,
        lastInsertRowid: typeof first?.id === 'number' ? first.id : undefined,
      };
    },
  };
}

export interface Tx {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

/** Database: pool cho query lẻ, transaction scoped cho multi-statement. */
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Truy vấn thô khi cần (vd: health check). */
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

async function poolQuery(text: string, params?: unknown[]) {
  return pool.query(translateSqlite(text), params as unknown[]);
}

function makeTx(client: PoolClient): Tx {
  const q: QueryFn = (text, params) => client.query(text, params as unknown[]);
  return {
    prepare: (sql) => makeStatement(q, sql),
    exec: async (sql) => {
      await client.query(translateSqlite(sql));
    },
  };
}

export const db: Db = {
  prepare: (sql) => makeStatement(poolQuery, sql),
  exec: async (sql) => {
    await poolQuery(translateSqlite(sql));
  },
  query: poolQuery,
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(makeTx(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

/** Đóng pool khi shutdown (graceful shutdown gọi hàm này). */
export async function closePool(): Promise<void> {
  await pool.end();
}
