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
  fs.mkdirSync(backupDir, { recursive: true });
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `educenter-backup-${stamp}.dump`;
  const filePath = path.join(backupDir, fileName);

  // pg_dump custom format (-Fc): nén, restore linh hoạt từng bảng
  // Parse URL để tránh lộ password trong process list (dùng PGPASSWORD env)
  const dbUrl = new URL(databaseUrl);
  const pgEnv = {
    ...process.env,
    PGHOST: dbUrl.hostname,
    PGPORT: dbUrl.port || '5432',
    PGDATABASE: dbUrl.pathname.slice(1),
    PGUSER: decodeURIComponent(dbUrl.username),
    PGPASSWORD: decodeURIComponent(dbUrl.password),
  };
  await execFileAsync('pg_dump', ['-Fc', '-f', filePath], {
    timeout: 10 * 60 * 1000,
    maxBuffer: 256 * 1024 * 1024,
    env: pgEnv,
  });

  const sizeBytes = fs.statSync(filePath).size;
  if (sizeBytes === 0) {
    fs.unlinkSync(filePath);
    throw new Error('Backup thất bại: file dump rỗng');
  }

  // Verify: file dump phải đọc được bằng pg_restore --list (phát hiện file hỏng ngay)
  try {
    await execFileAsync('pg_restore', ['--list', filePath], {
      timeout: 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fs.unlinkSync(filePath);
    throw new Error(`Backup thất bại: file dump không đọc được (${String(err)})`);
  }

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
