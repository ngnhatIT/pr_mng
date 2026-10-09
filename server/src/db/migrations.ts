import type { Db } from './connection';

/**
 * Migration lũy tiến cho DB cũ: thêm cột còn thiếu (idempotent).
 * DB mới đã có đủ cột từ schema nên các lệnh này sẽ bỏ qua êm.
 */
export function runMigrations(db: Db): void {
  function ensureColumn(table: string, column: string, definition: string): void {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      /* cột đã tồn tại — bỏ qua */
    }
  }

  ensureColumn('users', 'center_id', 'INTEGER');
  ensureColumn('users', 'teacher_id', 'INTEGER');
  ensureColumn('students', 'center_id', 'INTEGER');
  ensureColumn('teachers', 'center_id', 'INTEGER');
  ensureColumn('classes', 'center_id', 'INTEGER');
  ensureColumn('classes', 'room_id', 'INTEGER');
  ensureColumn('payments', 'status', "TEXT NOT NULL DEFAULT 'confirmed'");
  ensureColumn('sessions', 'checkin_code', 'TEXT');
  ensureColumn('sessions', 'checkin_date', 'TEXT');
  ensureColumn('parents', 'center_id', 'INTEGER');
  ensureColumn('leave_requests', 'center_id', 'INTEGER');
  ensureColumn('grades', 'center_id', 'INTEGER');
  ensureColumn('homework', 'center_id', 'INTEGER');
  ensureColumn('rooms', 'center_id', 'INTEGER');
  ensureColumn('trial_registrations', 'center_id', 'INTEGER');
  ensureColumn('leads', 'center_id', 'INTEGER');
  ensureColumn('reviews', 'center_id', 'INTEGER');

  // Bảng mới: theo dõi hoàn thành bài tập theo học viên
  db.exec(`CREATE TABLE IF NOT EXISTS homework_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    homework_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_by TEXT NOT NULL DEFAULT 'parent',
    UNIQUE(homework_id, student_id)
  )`);

  // Gói nâng cấp full (2026-10-08): cột mới cho homework
  ensureColumn('homework', 'status', "TEXT NOT NULL DEFAULT 'published'");
  ensureColumn('homework', 'publish_at', 'TEXT');
  ensureColumn('homework', 'max_score', 'REAL');
  ensureColumn('homework', 'close_date', 'TEXT');
  ensureColumn('homework', 'kind', "TEXT NOT NULL DEFAULT 'homework'");
  ensureColumn('homework', 'rubric_id', 'INTEGER');

  // Bảng mới: đính kèm, giao riêng, rubric, quiz, điểm
  db.exec(`CREATE TABLE IF NOT EXISTS homework_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, homework_id INTEGER NOT NULL,
    name TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'link')`);
  db.exec(`CREATE TABLE IF NOT EXISTS homework_targets (
    homework_id INTEGER NOT NULL, student_id INTEGER NOT NULL, due_date TEXT,
    UNIQUE(homework_id, student_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS rubrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT, center_id INTEGER, name TEXT NOT NULL,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS rubric_criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rubric_id INTEGER NOT NULL,
    name TEXT NOT NULL, max_score REAL NOT NULL DEFAULT 10, position INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, homework_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, question TEXT NOT NULL, points REAL NOT NULL DEFAULT 1)`);
  db.exec(`CREATE TABLE IF NOT EXISTS quiz_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, homework_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0, max_score REAL NOT NULL DEFAULT 0,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS quiz_answers (
    attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, option_id INTEGER,
    UNIQUE(attempt_id, question_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS homework_scores (
    homework_id INTEGER NOT NULL, student_id INTEGER NOT NULL, score REAL, feedback TEXT,
    graded_at TEXT NOT NULL DEFAULT (datetime('now')), graded_by INTEGER,
    UNIQUE(homework_id, student_id))`);
  // Gói "bằng mọi giá" (2026-10-08): ngân hàng câu hỏi + bài nộp
  db.exec(`CREATE TABLE IF NOT EXISTS question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT, center_id INTEGER, tag TEXT,
    question TEXT NOT NULL, points REAL NOT NULL DEFAULT 1,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS question_bank_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0)`);
  db.exec(`CREATE TABLE IF NOT EXISTS homework_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, homework_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL, file_url TEXT, file_name TEXT, note TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}