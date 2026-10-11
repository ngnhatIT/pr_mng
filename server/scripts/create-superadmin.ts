/**
 * Tạo tài khoản superadmin cho production.
 *
 * Dùng khi deploy fresh DB (SEED_DEMO=false nên không có tài khoản demo).
 * Chạy (trong thư mục server/):
 *   npx tsx scripts/create-superadmin.ts <username>
 * Mật khẩu KHÔNG truyền qua argv (lộ trong shell history và `ps`): script hỏi
 * mật khẩu (ẩn ký tự), hoặc đọc từ biến môi trường SUPERADMIN_PASSWORD khi chạy
 * không có terminal, vd: `read -rs SUPERADMIN_PASSWORD && export SUPERADMIN_PASSWORD`.
 *
 * Mật khẩu phải đủ mạnh (8+ ký tự, không phổ biến).
 */
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { db, closePool } from '../src/db/index.js';
import { assertStrongPassword } from '../src/shared/password.js';

/** Hỏi mật khẩu trên TTY, không echo ký tự gõ. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const [username, extra] = process.argv.slice(2);
  if (!username || extra) {
    console.error('Dùng: npx tsx scripts/create-superadmin.ts <username>   (mật khẩu: nhập khi được hỏi hoặc SUPERADMIN_PASSWORD)');
    process.exitCode = 1;
    return;
  }
  let password = process.env.SUPERADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('Không có terminal để hỏi mật khẩu — đặt biến môi trường SUPERADMIN_PASSWORD');
      process.exitCode = 1;
      return;
    }
    password = await promptHidden('Mật khẩu superadmin: ');
    if (password !== (await promptHidden('Nhập lại mật khẩu: '))) {
      console.error('Hai lần nhập không khớp');
      process.exitCode = 1;
      return;
    }
  }
  try {
    assertStrongPassword(password, 'Mật khẩu');
  } catch (err) {
    console.error('Mật khẩu yếu:', (err as Error).message);
    process.exitCode = 1;
    return;
  }
  const existing = await db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (existing) {
    console.error(`Username "${username}" đã tồn tại`);
    process.exitCode = 1;
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  await db
    .prepare(`INSERT INTO users (username, password_hash, role, name, center_id) VALUES (?, ?, 'superadmin', ?, NULL)`)
    .run(username, hash, username);
  console.log(`Đã tạo superadmin "${username}"`);
}

main()
  .catch((err) => {
    console.error('Lỗi:', err);
    process.exitCode = 1;
  })
  // Đóng pool để process thoát ngay (db không có end() — trước đây treo tới idle timeout).
  .finally(() => closePool());
