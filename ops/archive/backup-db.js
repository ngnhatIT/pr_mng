#!/usr/bin/env node
/**
 * EduCenterPro — Sao lưu database SQLite (data.db)
 * ------------------------------------------------
 * - Backup ONLINE: an toàn ngay cả khi app đang chạy (dùng API backup của SQLite,
 *   không cần tắt server, không copy file thô giữa chừng).
 * - File backup đặt tên theo thời gian: data-YYYYMMDD-HHMMSS.db
 * - Tự xóa bản cũ, mặc định giữ 7 bản gần nhất (đổi bằng env BACKUP_KEEP).
 *
 * Cách dùng:
 *   node ops/backup-db.js                      # dùng đường dẫn mặc định
 *   node ops/backup-db.js /duong/dan/server /noi/luu/backup
 *
 * Chạy tự động mỗi ngày 2h sáng (crontab trên server):
 *   0 2 * * * /usr/bin/node /opt/educenter-pro-full/ops/backup-db.js >> /var/log/educenter-backup.log 2>&1
 *
 * Khôi phục khi cần:
 *   1. Dừng app (npm stop / pm2 stop ...)
 *   2. cp /noi/luu/backup/data-YYYYMMDD-HHMMSS.db server/data.db
 *   3. Khởi động lại app
 */
'use strict';

const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server'));
const OUT_DIR = path.resolve(process.argv[3] || path.join(SERVER_DIR, 'backups'));
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || '7', 10));

const DB_FILE = path.join(SERVER_DIR, 'data.db');
const LOG_FILE = path.join(OUT_DIR, 'backup.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* thư mục log chưa tạo được thì bỏ qua */
  }
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`Không tìm thấy database: ${DB_FILE}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Kiểm tra quyền ghi trước khi backup
  fs.accessSync(OUT_DIR, fs.constants.W_OK);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15); // YYYYMMDD-HHMMSS
  let dest = path.join(OUT_DIR, `data-${stamp}.db`);
  // Chống trùng tên nếu chạy 2 lần trong cùng 1 giây
  for (let i = 1; fs.existsSync(dest); i++) {
    dest = path.join(OUT_DIR, `data-${stamp}-${i}.db`);
  }
  const cleanSidecars = (f) => {
    for (const suffix of ['-shm', '-wal', '-journal']) {
      try {
        fs.unlinkSync(f + suffix);
      } catch {
        /* không có thì thôi */
      }
    }
  };

  // Tìm better-sqlite3: npm workspaces có thể "hoist" lên node_modules ở repo root
  const candidates = [
    path.join(SERVER_DIR, 'node_modules', 'better-sqlite3'),
    path.join(SERVER_DIR, '..', 'node_modules', 'better-sqlite3'),
  ];
  let betterSqlite3 = null;
  for (const c of candidates) {
    try {
      betterSqlite3 = require(c);
      break;
    } catch {
      /* thử chỗ tiếp theo */
    }
  }
  if (!betterSqlite3) {
    throw new Error(
      'Không tìm thấy better-sqlite3. Hãy chạy `npm install` ở thư mục gốc dự án trước.'
    );
  }

  // Mở readonly — backup API của SQLite đọc an toàn ngay cả khi app đang ghi (WAL mode)
  const db = new betterSqlite3(DB_FILE, { readonly: true, timeout: 5000 });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  // Xác minh nhanh file backup đọc được và không rỗng
  const verify = new betterSqlite3(dest, { readonly: true });
  try {
    const row = verify.prepare('PRAGMA integrity_check').get();
    if (!row || row.integrity_check !== 'ok') {
      throw new Error(`Backup lỗi integrity: ${JSON.stringify(row)}`);
    }
    const tables = verify.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get();
    if (!tables || tables.c === 0) {
      throw new Error('Backup không chứa bảng nào — có gì đó sai.');
    }
  } finally {
    verify.close();
  }
  // Mở verify có thể tạo file -shm/-wal bên cạnh backup -> dọn để backup là 1 file duy nhất
  cleanSidecars(dest);

  const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
  log(`OK: đã backup -> ${dest} (${sizeMB} MB)`);

  // Xoá bản cũ, chỉ giữ KEEP bản mới nhất
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^data-\d{8}-\d{6}(-\d+)?\.db$/.test(f))
    .sort(); // tên file sắp xếp theo thời gian tăng dần
  while (files.length > KEEP) {
    const old = files.shift();
    const oldPath = path.join(OUT_DIR, old);
    fs.unlinkSync(oldPath);
    cleanSidecars(oldPath);
    log(`Đã xoá bản cũ: ${old} (giữ ${KEEP} bản gần nhất)`);
  }
}

main().catch((err) => {
  try {
    log(`LỖI: ${err.message}`);
  } catch {
    /* ignore */
  }
  process.stderr.write(`Backup thất bại: ${err.message}\n`);
  process.exit(1);
});
