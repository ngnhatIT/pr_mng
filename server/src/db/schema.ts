import type { Db } from './connection';

/** Tạo toàn bộ bảng (idempotent — IF NOT EXISTS). */
export function createSchema(db: Db): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  plan TEXT NOT NULL DEFAULT 'standard',
  plan_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS center_settings (
  center_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (center_id, key)
);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  subject TEXT
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  dob TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'studying',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  teacher_id INTEGER,
  schedule TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  end_date TEXT,
  tuition_fee REAL NOT NULL DEFAULT 0,
  max_students INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(student_id, class_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  topic TEXT,
  UNIQUE(class_id, date)
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  note TEXT,
  UNIQUE(session_id, student_id)
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  class_id INTEGER,
  amount REAL NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  method TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER,
  student_id INTEGER,
  phone TEXT,
  kind TEXT NOT NULL DEFAULT 'overdue',
  status TEXT NOT NULL DEFAULT 'sent',
  message TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* ---------- Bảng mới: cổng phụ huynh ---------- */
CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  referral_code TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(center_id, phone)
);
CREATE TABLE IF NOT EXISTS parent_students (
  parent_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, student_id)
);
/* ---------- Bảng mới: vận hành ---------- */
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  student_id INTEGER NOT NULL,
  class_id INTEGER,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  student_id INTEGER NOT NULL,
  class_id INTEGER,
  title TEXT NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL DEFAULT 10,
  comment TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS homework (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  due_date TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Gói nâng cấp full (2026-10-08): học từ Google Classroom/Canvas/Teams/Moodle
  status TEXT NOT NULL DEFAULT 'published', -- draft | scheduled | published
  publish_at TEXT, -- hẹn giờ đăng (status=scheduled)
  max_score REAL, -- điểm tối đa (null = không chấm điểm)
  close_date TEXT, -- hạn chót cứng: qua ngày này khóa nộp
  kind TEXT NOT NULL DEFAULT 'homework', -- homework | quiz
  rubric_id INTEGER
);
CREATE TABLE IF NOT EXISTS homework_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_by TEXT NOT NULL DEFAULT 'parent',
  UNIQUE(homework_id, student_id)
);
-- Đính kèm: file/link/audio (Google Classroom: Add resources)
CREATE TABLE IF NOT EXISTS homework_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link' -- link | file | audio | video
);
-- Giao riêng cho từng học viên (Classroom: individual students). Rỗng = cả lớp.
CREATE TABLE IF NOT EXISTS homework_targets (
  homework_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  due_date TEXT, -- hạn riêng (Canvas: differentiated deadlines)
  UNIQUE(homework_id, student_id)
);
-- Rubric tái sử dụng (Classroom/Teams/Canvas đều có)
CREATE TABLE IF NOT EXISTS rubrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rubric_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rubric_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  max_score REAL NOT NULL DEFAULT 10,
  position INTEGER NOT NULL DEFAULT 0
);
-- Quiz tự chấm (Classroom: Forms grade importing)
CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  question TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS quiz_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quiz_answers (
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  option_id INTEGER,
  UNIQUE(attempt_id, question_id)
);
-- Điểm bài tập thường (chấm tay hoặc theo rubric)
CREATE TABLE IF NOT EXISTS homework_scores (
  homework_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  score REAL,
  feedback TEXT,
  graded_at TEXT NOT NULL DEFAULT (datetime('now')),
  graded_by INTEGER,
  UNIQUE(homework_id, student_id)
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30
);
CREATE TABLE IF NOT EXISTS salary_rules (
  teacher_id INTEGER PRIMARY KEY,
  per_session_amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teacher_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS payment_txns (
  ref TEXT PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* ---------- Bảng mới: tuyển sinh & tăng trưởng ---------- */
CREATE TABLE IF NOT EXISTS trial_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  class_id INTEGER,
  desired_date TEXT,
  note TEXT,
  referral_code TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_parent_id INTEGER NOT NULL,
  referred_phone TEXT,
  referred_student_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  used_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  parent_id INTEGER,
  rating INTEGER NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_center ON audit_logs(center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
-- Ngân hàng câu hỏi tái dùng (Canvas/Moodle: question bank)
CREATE TABLE IF NOT EXISTS question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  tag TEXT,
  question TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS question_bank_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);
-- Bài nộp của học viên (ảnh/file bài làm)
CREATE TABLE IF NOT EXISTS homework_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  file_url TEXT,
  file_name TEXT,
  note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
}