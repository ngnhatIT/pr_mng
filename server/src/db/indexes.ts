import type { Db } from './connection';

/**
 * Indexes cho toàn bộ FK và hot query paths.
 * Idempotent — CREATE INDEX IF NOT EXISTS nên an toàn chạy nhiều lần.
 *
 * Nguyên tắc: mọi cột xuất hiện trong WHERE/JOIN/GROUP BY/ORDER BY
 * ở các query nóng đều cần index. Đặc biệt:
 * - center_id: mọi query multi-tenant đều lọc theo center
 * - FK columns: JOIN không index = full table scan
 * - status/date: filter dashboard và scheduler
 */
export function createIndexes(db: Db): void {
  db.exec(`
-- ===== Multi-tenant scope (hầu hết query đều có center_id) =====
CREATE INDEX IF NOT EXISTS idx_students_center ON students(center_id, status);
CREATE INDEX IF NOT EXISTS idx_teachers_center ON teachers(center_id);
CREATE INDEX IF NOT EXISTS idx_classes_center ON classes(center_id);
CREATE INDEX IF NOT EXISTS idx_rooms_center ON rooms(center_id);
CREATE INDEX IF NOT EXISTS idx_parents_center ON parents(center_id);
CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id);
CREATE INDEX IF NOT EXISTS idx_grades_center ON grades(center_id);
CREATE INDEX IF NOT EXISTS idx_leaves_center ON leave_requests(center_id);

-- ===== Homework module (hot) =====
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_center_status ON homework(center_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_scheduled ON homework(status, publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_homework_due ON homework(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hw_completions ON homework_completions(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_hw_attachments ON homework_attachments(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_targets_hw ON homework_targets(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_targets_student ON homework_targets(student_id);
CREATE INDEX IF NOT EXISTS idx_hw_scores ON homework_scores(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_hw_submissions ON homework_submissions(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_hw ON quiz_questions(homework_id, position);
CREATE INDEX IF NOT EXISTS idx_quiz_options_q ON quiz_options(question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts ON quiz_attempts(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt ON quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_rubric_criteria ON rubric_criteria(rubric_id, position);
CREATE INDEX IF NOT EXISTS idx_rubrics_center ON rubrics(center_id);
CREATE INDEX IF NOT EXISTS idx_qbank_center ON question_bank(center_id, tag);
CREATE INDEX IF NOT EXISTS idx_qbank_options ON question_bank_options(question_id);

-- ===== Enrollments & attendance (hot) =====
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_class_date ON sessions(class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, status);

-- ===== Finance =====
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date, status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_txns_ref ON payment_txns(ref);
CREATE INDEX IF NOT EXISTS idx_credits_parent ON credits(parent_id);

-- ===== Parent portal =====
CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);
CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone);
CREATE INDEX IF NOT EXISTS idx_students_code ON students(code);
CREATE INDEX IF NOT EXISTS idx_leaves_student ON leave_requests(student_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_parent ON referrals(referrer_parent_id);
CREATE INDEX IF NOT EXISTS idx_reviews_center ON reviews(center_id, status);

-- ===== Operations =====
CREATE INDEX IF NOT EXISTS idx_reminders_kind ON reminders(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_reminders_center ON reminders(center_id, kind);
CREATE INDEX IF NOT EXISTS idx_teacher_checkins ON teacher_checkins(teacher_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trial_center ON trial_registrations(center_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_center ON leads(center_id, status);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);
}
