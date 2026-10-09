import { Pool, PoolClient, types } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';

// Nạp .env (nếu có) trước khi đọc DATABASE_URL — dev tiện, production dùng env thật.
dotenv.config();

// PostgreSQL trả BIGINT (OID 20, ví dụ COUNT(*)) dạng string để tránh mất precision.
// App này dùng COUNT cho pagination — ép về number cho đồng nhất với SQLite cũ.
// (Giá trị > Number.MAX_SAFE_INTEGER không xảy ra với COUNT trong app này.)
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/**
 * Actor của request HTTP hiện tại ('<userId>:<role>'), do middleware
 * auth (requireAuth/parentAuth) thiết lập qua AsyncLocalStorage.
 *
 * poolQuery/transaction đọc context này để gắn `SET LOCAL app.user_id`
 * lên ĐÚNG connection thực thi query — trigger audit (audit_payment,
 * audit_invoice) đọc qua `current_setting('app.user_id', true)` để ghi
 * `changed_by`. Ngoài request (boot, scheduler, health check) thì không
 * có actor — query chạy đường nhanh như cũ.
 */
export const requestActor = new AsyncLocalStorage<string>();

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

// Fail-fast: DATABASE_URL bắt buộc (pg fallback sang default local nếu undefined → boot "thành công" nhầm DB)
import { env } from '../config/env';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  // Không treo vô hạn khi DB unreachable: fail-fast sau 5s để request báo lỗi
  // thay vì kẹt worker.
  connectionTimeoutMillis: 5000,
  // Thu hồi connection nhàn rỗi sau 30s.
  idleTimeoutMillis: 30000,
  // statement_timeout: kill query chạy quá 30s (chống runaway làm cạn pool).
  // timezone=Asia/Ho_Chi_Minh: NOW() trả giờ VN nhất quán mọi môi trường.
  options: '-c statement_timeout=30000 -c timezone=Asia/Ho_Chi_Minh',
});

pool.on('error', (err) => {
  // Pool error không crash app, nhưng phải thấy được trong log
  // eslint-disable-next-line no-console
  console.error('[pg pool error]', err.message);
});

/* ------------------------- Dịch SQL SQLite -> PG ------------------------- */

/** Đổi `?` thành `$n` và `LIKE` thành `ILIKE`, bỏ qua literal / comment / identifier. */
function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let i = 0;
  const len = sql.length;
  const isWordStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
  while (i < len) {
    const ch = sql[i];
    // string literal '...' — giữ nguyên, kể cả từ LIKE nằm bên trong
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
    // Từ khóa LIKE ngoài literal/comment -> ILIKE (SQLite LIKE không phân biệt
    // hoa thường). Quét theo từ để 'I LIKE apples' trong literal không bị đổi,
    // và từ đã là ILIKE không bị đổi lần 2 (idempotent).
    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < len && isWordChar(sql[j])) j++;
      const word = sql.slice(i, j);
      out += word.toUpperCase() === 'LIKE' ? 'ILIKE' : word;
      i = j;
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
  // LIKE -> ILIKE được xử lý trong toPgPlaceholders (nhận biết string literal)
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
const NO_ID_TABLES = new Set([
  'center_settings',
  'settings',
  'salary_rules',
  'payment_txns',
  'parent_students',
  'homework_targets',
  'homework_scores',
  'quiz_answers',
  'role_permissions',
  'user_roles',
  'schema_migrations',
]);

/**
 * Chuẩn hóa params: nếu caller truyền 1 array duy nhất (vd: .all([a, b]))
 * thì bung ra thành variadic. Phòng thủ cho cả lớp bug "bind message supplies
 * 1 parameters" — từng làm sập loginParent/linkStudent (pentest 2026-10-09).
 */
function normParams(params: unknown[]): unknown[] {
  return params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
}

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
      const r = await queryFn(pgSql, normParams(params));
      return r.rows[0] ?? undefined;
    },
    async all(...params: unknown[]): Promise<unknown[]> {
      const r = await queryFn(pgSql, normParams(params));
      return r.rows;
    },
    async run(...params: unknown[]): Promise<RunResult> {
      const r = await queryFn(pgSql, normParams(params));
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
  /**
   * Lấy dedicated client từ pool (dùng cho advisory lock — lock/unlock phải cùng session).
   * Caller phải gọi client.release() trong finally.
   */
  connect(): Promise<{
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
    release(): void;
  }>;
}

/** Mã lỗi PG transient — đáng thử lại (failover, restart, quá tải tạm thời). */
const TRANSIENT_PG_CODES = new Set(['53300', '53400', '57P03', '57P01', '08006', '08001', '08004']);

function isTransientDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code && TRANSIENT_PG_CODES.has(e.code)) return true;
  const msg = e?.message || '';
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|terminating connection/i.test(msg);
}

async function poolQuery(text: string, params?: unknown[]) {
  const sql = translateSqlite(text);
  const actor = requestActor.getStore();
  // Không có actor (boot, scheduler, health check, test): đường nhanh như cũ.
  // Retry 1 lần cho lỗi transient (PG restart/failover vài giây).
  if (!actor) {
    try {
      return await pool.query(sql, params as unknown[]);
    } catch (err) {
      if (!isTransientDbError(err)) throw err;
      await new Promise((r) => setTimeout(r, 300));
      return await pool.query(sql, params as unknown[]);
    }
  }
  // Có actor (request đã đăng nhập): giữ 1 connection riêng, mở transaction,
  // gắn SET LOCAL app.user_id rồi mới chạy query — đảm bảo trigger audit đọc
  // được actor trên ĐÚNG connection ghi. SET LOCAL tự hết hiệu lực khi
  // COMMIT/ROLLBACK nên không rò sang request khác dùng chung pool.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', actor]);
    } catch {
      // Audit là best-effort: thiếu actor thì changed_by = NULL, không chặn nghiệp vụ.
    }
    const r = await client.query(sql, params as unknown[]);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
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
  // poolQuery đã tự dịch SQL — không dịch 2 lần.
  exec: async (sql) => {
    await poolQuery(sql);
  },
  query: poolQuery,
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const actor = requestActor.getStore();
    try {
      await client.query('BEGIN');
      if (actor) {
        try {
          await client.query('SELECT set_config($1, $2, true)', ['app.user_id', actor]);
        } catch {
          // Audit là best-effort — không chặn transaction nghiệp vụ.
        }
      }
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
  async connect() {
    const client = await pool.connect();
    return {
      query: async (text: string, params?: unknown[]) => {
        const r = await client.query(text, params as unknown[]);
        return { rows: r.rows, rowCount: r.rowCount };
      },
      release: () => client.release(),
    };
  },
};

/** Đóng pool khi shutdown (graceful shutdown gọi hàm này). */
export async function closePool(): Promise<void> {
  await pool.end();
}

/** Thống kê pool cho /metrics — phát hiện cạn connection trước khi timeout. */
export function getPoolStats(): { total: number; idle: number; waiting: number } {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
