/**
 * Test utilities cho PostgreSQL.
 *
 * Cách dùng trong mỗi file test DB (ĐẶT DÒNG ĐẦU TIÊN, trước mọi import db):
 *   process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';
 *   import { describe, it, before, beforeEach, after } from 'node:test';
 *   import { db } from './pg-compat';
 *   import { setupTestDb, resetTestDb, teardownTestDb } from './test-utils';
 *
 *   before(async () => { await setupTestDb(); });
 *   beforeEach(async () => { await resetTestDb(); });
 *   after(async () => { await teardownTestDb(); });
 *
 * - setupTestDb(): xóa schema public và tạo lại từ schema.ts hiện tại.
 * - resetTestDb(): TRUNCATE toàn bộ bảng (CASCADE), giữ schema.
 * - teardownTestDb(): đóng pool test.
 *
 * LƯU Ý: test chạy trên database RIÊNG (educenter_test), không bao giờ chạm
 * vào database chính (educenter).
 */
import { Pool, types } from 'pg';

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const TEST_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: TEST_URL, max: 5 });
  return pool;
}

/** Tạo schema mới từ schema.ts hiện tại (xóa hết bảng public trước). */
export async function setupTestDb(): Promise<void> {
  const p = getPool();
  await p.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);
  const dbAdapter = {
    exec: (sql: string) => p.query(sql).then(() => undefined),
    query: async (text: string, params: unknown[] = []) => {
      let i = 0;
      const pgSql = text.replace(/\?/g, () => `$${++i}`);
      const r = await p.query(pgSql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount };
    },
  };
  const { createSchema, createTriggers, createViews, createHistoryTables } = await import('./schema');
  await createSchema(dbAdapter as never);
  const { runMigrations } = await import('./migrations');
  await runMigrations(dbAdapter as never);
  await createTriggers(dbAdapter as never);
  await createHistoryTables(dbAdapter as never);
  await createViews(dbAdapter as never);
}

/** Xóa dữ liệu tất cả bảng, giữ schema. Giữ lại schema_migrations. */
export async function resetTestDb(): Promise<void> {
  await getPool().query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'schema_migrations') LOOP
        EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}

export async function teardownTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  try {
    const { closePool } = await import('./pg-compat');
    await closePool();
  } catch {
    // pg-compat chưa được load — bỏ qua
  }
}

/** Seed tối thiểu: 1 center + 1 student. */
export async function seedMinimal(): Promise<{ centerId: number; studentId: number }> {
  const p = getPool();
  const c = await p.query(`INSERT INTO centers (name) VALUES ('TT Test') RETURNING id`);
  const centerId = Number(c.rows[0].id);
  const s = await p.query(`INSERT INTO students (code, name, center_id) VALUES ('HV1', 'Học viên Test', $1) RETURNING id`, [centerId]);
  const studentId = Number(s.rows[0].id);
  return { centerId, studentId };
}
