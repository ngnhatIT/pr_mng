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
 * - teardownTestDb(): đóng pool test (pool `db` của app tự nhả nhờ allowExitOnIdle).
 *
 * LƯU Ý: test chạy trên database RIÊNG (educenter_test), không bao giờ chạm
 * vào database chính (educenter). setupTestDb/resetTestDb TỪ CHỐI chạy nếu DB
 * đang kết nối không có tên kết thúc bằng '_test' (hoặc dạng '_test_<suffix>').
 */
import { Pool, types } from 'pg';

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const TEST_URL =
  process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool)
    pool = new Pool({
      connectionString: TEST_URL,
      max: 5,
      // Đồng nhất timezone với production (Asia/Ho_Chi_Minh)
      options: '-c timezone=Asia/Ho_Chi_Minh',
    });
  return pool;
}

let verified = false;

/**
 * DATA-8: chặn helper phá hủy (DROP/TRUNCATE) chạy nhầm vào DB thật. Cả pool test
 * lẫn `db` (pg-compat — đọc DATABASE_URL, có thể lấy từ server/.env nếu file test
 * quên đặt) đều phải trỏ tới database tên kết thúc bằng '_test'.
 */
export async function assertTestDatabase(): Promise<void> {
  if (verified) return;
  const { db } = await import('./pg-compat');
  const sql = 'SELECT current_database() AS d';
  const names = [(await getPool().query(sql)).rows[0].d, ((await db.query(sql)).rows[0] as { d: string }).d];
  for (const name of names) {
    if (!/_test(_\w+)?$/.test(String(name))) {
      throw new Error(`[TEST] Từ chối DROP/TRUNCATE trên database "${name}" — tên phải kết thúc bằng _test`);
    }
  }
  verified = true;
}

/** Tạo schema mới giống hệt production (xóa hết bảng public trước). */
export async function setupTestDb(): Promise<void> {
  await assertTestDatabase();
  const p = getPool();
  await p.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);
  // Cùng các bước DDL như initDatabase (DATA-7: gồm cả createIndexes), qua chính `db`
  // của app — đã xác nhận ở trên là trỏ test DB.
  const { db } = await import('./pg-compat');
  const { createSchema, createTriggers, createViews, createHistoryTables } = await import('./schema');
  const { runMigrations, bootDdlDb } = await import('./migrations');
  const { createIndexes } = await import('./indexes');
  const ddl = bootDdlDb(db);
  await createSchema(ddl);
  await runMigrations(db);
  await createIndexes(ddl);
  await createTriggers(ddl);
  await createHistoryTables(ddl);
  await createViews(ddl);
}

/** Xóa dữ liệu tất cả bảng, giữ schema. Giữ lại schema_migrations. */
export async function resetTestDb(): Promise<void> {
  await assertTestDatabase();
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
  verified = false;
  // KHÔNG đóng pool của pg-compat: file test có nhiều describe (mỗi suite before/after riêng)
  // dùng tiếp `db` sau after() của suite trước -> "Cannot use a pool after calling end on the
  // pool". Pool app đặt allowExitOnIdle nên process test vẫn tự thoát khi xong.
}

/** Seed tối thiểu: 1 center + 1 student. */
export async function seedMinimal(): Promise<{ centerId: number; studentId: number }> {
  const p = getPool();
  const c = await p.query(`INSERT INTO centers (name) VALUES ('TT Test') RETURNING id`);
  const centerId = Number(c.rows[0].id);
  const s = await p.query(
    `INSERT INTO students (code, name, center_id) VALUES ('HV1', 'Học viên Test', $1) RETURNING id`,
    [centerId]
  );
  const studentId = Number(s.rows[0].id);
  return { centerId, studentId };
}
