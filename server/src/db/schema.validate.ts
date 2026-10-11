/* validateSchema — tự kiểm tra schema trên DB hiện tại. B3-3: tách khỏi schema.ts. */
import type { Db } from './pg-compat';
import { TABLE_DOCS } from './schema.docs';
import { MAINTAIN_TABLES } from './schema.triggers';

/* -------------------------------------------------------------------------------------
 * validateSchema — tự kiểm tra tính toàn vẹn của schema trên DB hiện tại.
 * PostgreSQL tự enforce FK khi ghi nên không cần kiểm tra orphan như SQLite.
 * ----------------------------------------------------------------------------------- */
const EXPECTED_TABLES = Object.keys(TABLE_DOCS);

/** Số FK kỳ vọng cho từng bảng (0 = cố tình không đặt). */
const EXPECTED_FK_COUNT: Record<string, number> = {
  users: 2,
  centers: 0,
  center_settings: 1,
  settings: 0,
  teachers: 1,
  students: 1,
  rooms: 1,
  classes: 3,
  enrollments: 2,
  sessions: 2,
  attendance: 2,
  teacher_checkins: 2,
  salary_rules: 1,
  salary_rate_history: 2,
  payroll_closures: 2,
  invoices: 3,
  payments: 2,
  payment_txns: 1,
  credits: 3,
  parents: 1,
  parent_students: 2,
  leave_requests: 4,
  grades: 4,
  reviews: 2,
  referrals: 3,
  rubrics: 2,
  rubric_criteria: 1,
  homework: 4,
  homework_attachments: 1,
  homework_targets: 2,
  homework_completions: 2,
  homework_scores: 3,
  homework_submissions: 2,
  quiz_questions: 1,
  quiz_options: 1,
  quiz_attempts: 2,
  quiz_answers: 3,
  quiz_essay_scores: 5,
  question_bank: 2,
  question_bank_options: 1,
  trial_registrations: 2,
  leads: 1,
  reminders: 3,
  audit_logs: 0,
  reset_requests: 1,
  uploads: 2,
  parent_link_failures: 2,
  payment_history: 0,
  invoice_history: 0,
  // RBAC (trước đây thiếu kiểm tra)
  roles: 1,
  role_permissions: 2,
  user_roles: 2,
  permissions: 0,
};

export async function validateSchema(db: Db): Promise<void> {
  const problems: string[] = [];

  const tables = (
    (await db.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`)).rows as {
      name: string;
    }[]
  ).map((r) => r.name);
  const existing = new Set(tables);
  for (const t of EXPECTED_TABLES) {
    if (!existing.has(t)) problems.push(`Thiếu bảng: ${t}`);
  }

  for (const [table, expected] of Object.entries(EXPECTED_FK_COUNT)) {
    if (!existing.has(table)) continue;
    const r = await db.query(
      `SELECT COUNT(*)::int AS c FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f'`,
      [table]
    );
    const c = (r.rows[0] as { c: number }).c;
    if (c !== expected) problems.push(`Bảng ${table}: kỳ vọng ${expected} FK, thực tế ${c}`);
  }

  const trgs = (
    (await db.query(`SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal`)).rows as {
      name: string;
    }[]
  ).map((r) => r.name);
  const tset = new Set(trgs);
  for (const t of MAINTAIN_TABLES) {
    if (!tset.has(`trg_${t}_maintain`)) problems.push(`Thiếu trigger: trg_${t}_maintain`);
  }
  for (const t of ['payments', 'invoices']) {
    if (!tset.has(`trg_${t}_audit`)) problems.push(`Thiếu trigger: trg_${t}_audit`);
  }

  const views = (
    (await db.query(`SELECT viewname AS name FROM pg_views WHERE schemaname = 'public'`)).rows as {
      name: string;
    }[]
  ).map((r) => r.name);
  if (!views.includes('v_invoice_balance')) problems.push('Thiếu view: v_invoice_balance');

  if (problems.length > 0) {
    throw new Error(`Schema không đạt chuẩn:\n- ${problems.join('\n- ')}`);
  }
}
