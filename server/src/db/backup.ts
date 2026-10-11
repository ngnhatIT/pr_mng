import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env } from '../config/env';

const execFileAsync = promisify(execFile);

/**
 * Backup database vật lý — chuẩn vận hành production cho PostgreSQL.
 *
 * - Dùng `pg_dump` (custom format, nén): backup online, nhất quán,
 *   không cần dừng server.
 * - File backup đặt tên theo thời gian, tự xoay vòng giữ N bản mới nhất.
 * - Yêu cầu: binary `pg_dump` có trong PATH và DATABASE_URL hợp lệ.
 * - Khôi phục: pg_restore -d <db> <file>
 *
 * Lịch chạy gợi ý (cron): mỗi đêm 2h sáng, giữ 7 bản.
 */

export interface BackupResult {
  path: string;
  sizeBytes: number;
  kept: number;
  deleted: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export async function backupDatabase(backupDir: string, keep = 7): Promise<BackupResult> {
  const databaseUrl = env.DATABASE_URL;
  // OPS-4: dump chứa toàn bộ PII + hash mật khẩu -> thư mục chỉ chủ sở hữu đọc được (0700).
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `educenter-backup-${stamp}.dump`;
  const filePath = path.join(backupDir, fileName);
  // Ghi ra file .tmp rồi rename nguyên tử: crash giữa chừng không bao giờ để
  // lại file backup tên chính thức bị dở dang (rotation chỉ thấy file hoàn chỉnh).
  const tmpPath = `${filePath}.tmp`;

  // pg_dump custom format (-Fc): nén, restore linh hoạt từng bảng
  // DATA-23: truyền NGUYÊN connection string qua --dbname (giữ ?sslmode=, ?host=/socket...),
  // chỉ tách password sang PGPASSWORD để không lộ trong process list.
  const dbUrl = new URL(databaseUrl);
  const password = decodeURIComponent(dbUrl.password);
  dbUrl.password = '';
  const pgEnv = password ? { ...process.env, PGPASSWORD: password } : process.env;
  try {
    await execFileAsync('pg_dump', ['-Fc', '-f', tmpPath, `--dbname=${dbUrl.toString()}`], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 256 * 1024 * 1024,
      env: pgEnv,
    });
  } catch (err) {
    // pg_dump fail → xóa file dở dang (tránh file partial bị tính là backup hợp lệ)
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* bỏ qua */
    }
    throw err;
  }

  const sizeBytes = fs.statSync(tmpPath).size;
  if (sizeBytes === 0) {
    fs.unlinkSync(tmpPath);
    throw new Error('Backup thất bại: file dump rỗng');
  }

  // Verify: file dump phải đọc được bằng pg_restore --list (phát hiện file hỏng ngay)
  try {
    await execFileAsync('pg_restore', ['--list', tmpPath], {
      timeout: 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fs.unlinkSync(tmpPath);
    throw new Error(`Backup thất bại: file dump không đọc được (${String(err)})`, { cause: err });
  }

  // OPS-4: pg_dump tạo file theo umask (thường 0644) -> siết 0600 trước khi lộ tên chính thức.
  fs.chmodSync(tmpPath, 0o600);

  // Rename nguyên tử: từ đây file tên chính thức mới tồn tại và đã hoàn chỉnh.
  fs.renameSync(tmpPath, filePath);

  // Xoay vòng: giữ N bản mới nhất
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('educenter-backup-') && f.endsWith('.dump'))
    .sort(); // tên có timestamp nên sort chuỗi = sort thời gian
  const deleted: string[] = [];
  while (backups.length > keep) {
    const old = backups.shift() as string;
    fs.unlinkSync(path.join(backupDir, old));
    deleted.push(old);
  }

  return { path: filePath, sizeBytes, kept: backups.length, deleted };
}
