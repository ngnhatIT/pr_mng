import Database from 'better-sqlite3';
import path from 'path';

/**
 * Kết nối SQLite duy nhất của ứng dụng (singleton).
 * File DB nằm ở server/data.db, tự tạo khi chạy lần đầu.
 */
const dbPath = path.resolve(__dirname, '..', 'data.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// Chờ tối đa 5s khi DB bị lock (tránh SQLITE_BUSY khi nhiều request ghi đồng thời)
db.pragma('busy_timeout = 5000');
// Đồng bộ NORMAL: cân bằng an toàn/tốc độ với WAL (WAL vẫn bền vững khi crash OS)
db.pragma('synchronous = NORMAL');

export type Db = typeof db;
