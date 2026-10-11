/**
 * Rollback migration (OPS-1) — chạy `down` của các migration đã áp dụng, từ mới nhất về <version>.
 *
 * Dùng khi phải lùi bản release sau khi DB đã được nâng cấp (code cũ từ chối boot trên DB mới hơn).
 * Chạy (trong thư mục server/, DATABASE_URL lấy từ server/.env):
 *   npx tsx scripts/migrate-down.ts --to <version>          # chỉ in kế hoạch (dry-run)
 *   npx tsx scripts/migrate-down.ts --to <version> --yes    # thực sự rollback
 * Ví dụ lùi v22 về v21: --to 21 --yes (giữ lại v21, gỡ mọi migration > 21).
 *
 * LUÔN pg_dump -Fc trước khi chạy: down có thể làm mất dữ liệu của cột/bảng mới.
 * Mỗi migration chạy trong 1 transaction cùng advisory lock với runMigrations; lỗi -> dừng
 * ngay tại migration đó (các bước trước đã commit). Từ chối nếu migration nào cần gỡ chưa có `down`.
 */
import { db, closePool } from '../src/db/index.js';
import { MIGRATIONS, beginMigrationTx, explainMigrationError } from '../src/db/migrations.js';

function parseArgs(argv: string[]): { to: number | null; yes: boolean } {
  const i = argv.indexOf('--to');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const to = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  return { to, yes: argv.includes('--yes') };
}

async function main(): Promise<void> {
  const { to, yes } = parseArgs(process.argv.slice(2));
  if (to === null) {
    console.error('Dùng: npx tsx scripts/migrate-down.ts --to <version> [--yes]');
    process.exitCode = 1;
    return;
  }

  const rows = (await db.prepare('SELECT version FROM schema_migrations').all()) as { version: number }[];
  const applied = new Set(rows.map((r) => Number(r.version)));
  // Mới nhất trước. Chỉ migration đã ghi nhận trong schema_migrations và > to.
  const plan = MIGRATIONS.filter((m) => m.version > to && applied.has(m.version)).sort(
    (a, b) => b.version - a.version
  );

  if (plan.length === 0) {
    console.log(`Không có migration nào > ${to} đang áp dụng — không làm gì.`);
    return;
  }
  const noDown = plan.filter((m) => !m.down);
  if (noDown.length > 0) {
    console.error(
      `Không thể rollback về ${to}: migration chưa có down -> ${noDown.map((m) => `v${m.version}`).join(', ')}. ` +
        'Restore từ bản pg_dump thay vì rollback.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Sẽ rollback (theo thứ tự): ${plan.map((m) => `v${m.version} ${m.name}`).join(' -> ')}`);
  if (!yes) {
    console.log('Dry-run. Đã pg_dump -Fc chưa? Thêm --yes để thực hiện.');
    process.exitCode = 1;
    return;
  }

  for (const m of plan) {
    await db
      .transaction(async (tx) => {
        // J-A3: như runMigrations — statement_timeout 0 (down v23 tạo lại 16 index), lock_timeout sau advisory lock
        await beginMigrationTx(tx);
        await m.down!(tx);
        await tx.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version);
      })
      .catch((err: unknown) => {
        throw explainMigrationError(err, `rollback v${m.version} ${m.name}`);
      });
    console.log(`Đã rollback v${m.version} ${m.name}`);
  }
  // N5-1: xóa tag boot-ddl — code cũ CREATE OR REPLACE thân cũ nhưng giữ COMMENT; lên lại bản mới thì boot
  // tạo lại mọi view/function (bootDdlDb cũng so md5 định nghĩa, đây là lớp phòng thứ hai).
  await db.exec(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT oid FROM pg_proc WHERE obj_description(oid, 'pg_proc') LIKE 'boot-ddl:%' LOOP
      EXECUTE format('COMMENT ON FUNCTION %s IS NULL', r.oid::regprocedure);
    END LOOP;
    FOR r IN SELECT oid FROM pg_class WHERE relkind = 'v' AND obj_description(oid, 'pg_class') LIKE 'boot-ddl:%' LOOP
      EXECUTE format('COMMENT ON VIEW %s IS NULL', r.oid::regclass);
    END LOOP;
  END $$`);
  console.log(`Xong. DB ở version ${to}. Triển khai lại code tương ứng rồi khởi động app.`);
}

main()
  .catch((err) => {
    console.error('Lỗi:', err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
