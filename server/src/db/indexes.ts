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
export async function createIndexes(db: Db): Promise<void> {
  await db.exec(`
-- ===== Multi-tenant scope (hầu hết query đều có center_id) =====
CREATE INDEX IF NOT EXISTS idx_students_center ON students(center_id, status);
CREATE INDEX IF NOT EXISTS idx_teachers_center ON teachers(center_id);
CREATE INDEX IF NOT EXISTS idx_classes_center ON classes(center_id);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_classes_room ON classes(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_center ON rooms(center_id);
CREATE INDEX IF NOT EXISTS idx_parents_center ON parents(center_id);
CREATE INDEX IF NOT EXISTS idx_invoices_center ON invoices(center_id);
CREATE INDEX IF NOT EXISTS idx_invoices_class ON invoices(class_id);
CREATE INDEX IF NOT EXISTS idx_grades_center ON grades(center_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_class ON grades(class_id);
CREATE INDEX IF NOT EXISTS idx_grades_creator ON grades(created_by);
CREATE INDEX IF NOT EXISTS idx_leaves_center ON leave_requests(center_id);
CREATE INDEX IF NOT EXISTS idx_leaves_class ON leave_requests(class_id);
CREATE INDEX IF NOT EXISTS idx_leaves_decider ON leave_requests(decided_by);

-- ===== Homework module (hot) =====
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_center_status ON homework(center_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_creator ON homework(created_by);
CREATE INDEX IF NOT EXISTS idx_homework_rubric ON homework(rubric_id);
CREATE INDEX IF NOT EXISTS idx_homework_scheduled ON homework(status, publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_homework_due ON homework(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hw_completions ON homework_completions(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_hw_attachments ON homework_attachments(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_targets_hw ON homework_targets(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_targets_student ON homework_targets(student_id);
CREATE INDEX IF NOT EXISTS idx_hw_scores ON homework_scores(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_hw_scores_grader ON homework_scores(graded_by);
CREATE INDEX IF NOT EXISTS idx_hw_submissions ON homework_submissions(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_hw ON quiz_questions(homework_id, position);
CREATE INDEX IF NOT EXISTS idx_quiz_options_q ON quiz_options(question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts ON quiz_attempts(homework_id, student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt ON quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_question ON quiz_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_option ON quiz_answers(option_id);
CREATE INDEX IF NOT EXISTS idx_rubric_criteria ON rubric_criteria(rubric_id, position);
CREATE INDEX IF NOT EXISTS idx_rubrics_center ON rubrics(center_id);
CREATE INDEX IF NOT EXISTS idx_rubrics_creator ON rubrics(created_by);
CREATE INDEX IF NOT EXISTS idx_qbank_center ON question_bank(center_id, tag);
CREATE INDEX IF NOT EXISTS idx_qbank_creator ON question_bank(created_by);
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
-- Doanh thu theo tháng lọc range trên paid_at — không có index này thì range vẫn full scan
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at);
-- GHI CHÚ: payment_txns.ref là PRIMARY KEY nên đã có index — không tạo thêm.
CREATE INDEX IF NOT EXISTS idx_credits_parent ON credits(parent_id);

-- ===== Parent portal =====
CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);
CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone);
CREATE INDEX IF NOT EXISTS idx_students_code ON students(code);
CREATE INDEX IF NOT EXISTS idx_leaves_student ON leave_requests(student_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_parent ON referrals(referrer_parent_id);
CREATE INDEX IF NOT EXISTS idx_referrals_student ON referrals(referred_student_id);
CREATE INDEX IF NOT EXISTS idx_reviews_center ON reviews(center_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_parent ON reviews(parent_id);

-- ===== Operations =====
CREATE INDEX IF NOT EXISTS idx_reminders_kind ON reminders(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_reminders_center ON reminders(center_id, kind);
CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_reminders_student ON reminders(student_id);
CREATE INDEX IF NOT EXISTS idx_teacher_checkins ON teacher_checkins(teacher_id, created_at);
CREATE INDEX IF NOT EXISTS idx_teacher_checkins_session ON teacher_checkins(session_id);
CREATE INDEX IF NOT EXISTS idx_trial_center ON trial_registrations(center_id, status);
CREATE INDEX IF NOT EXISTS idx_trial_class ON trial_registrations(class_id);
CREATE INDEX IF NOT EXISTS idx_leads_center ON leads(center_id, status);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_center ON users(center_id);
CREATE INDEX IF NOT EXISTS idx_users_teacher ON users(teacher_id);

-- Mỗi phụ huynh 1 đánh giá / trung tâm (bổ sung cho migration v3)
CREATE UNIQUE INDEX IF NOT EXISTS parent_reviews_unique ON reviews(parent_id, center_id) WHERE parent_id IS NOT NULL;
`);
}
