/**
 * Tạo tài khoản superadmin cho production.
 *
 * Dùng khi deploy fresh DB (SEED_DEMO=false nên không có tài khoản demo).
 * Chạy: npx tsx scripts/create-superadmin.ts <username> <password>
 *
 * Mật khẩu phải đủ mạnh (8+ ký tự, không phổ biến).
 */
import bcrypt from 'bcryptjs';
import { db } from '../src/db/index.js';
import { assertStrongPassword } from '../src/shared/password.js';

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Dùng: npx tsx scripts/create-superadmin.ts <username> <password>');
    process.exit(1);
  }
  try {
    assertStrongPassword(password, 'Mật khẩu');
  } catch (err) {
    console.error('Mật khẩu yếu:', (err as Error).message);
    process.exit(1);
  }
  const existing = (await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) as
    | { '1'?: number }
    | undefined;
  if (existing) {
    console.error(`Username "${username}" đã tồn tại`);
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  await db
    .prepare(`INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, 'superadmin', ?, NULL)`)
    .run(username, hash, username);
  console.log(`Đã tạo superadmin "${username}"`);
  await db.end?.();
}

main().catch((err) => {
  console.error('Lỗi:', err);
  process.exit(1);
});
