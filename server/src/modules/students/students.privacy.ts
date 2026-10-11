import { db } from '../../db';
import { findByIdOr404 } from '../../shared/repository';
import { audit, type AuditActor } from '../../shared/audit';
import { AppError } from '../../shared/errors';

/**
 * Quyền dữ liệu cá nhân (GDPR điều 15/17, Nghị định 13/2023 của VN):
 * - exportStudentData: toàn bộ dữ liệu gắn với 1 học viên (JSON đọc được bằng máy).
 * - anonymizeStudent: xóa thông tin định danh nhưng GIỮ chứng từ tài chính và kết quả học (nghĩa vụ kế toán,
 *   thống kê) — thay cho xóa cứng vốn xóa luôn hóa đơn/thanh toán.
 */

/** Bảng có student_id trực tiếp: tên khóa trong file xuất -> câu SELECT (chỉ chuỗi do code viết). */
const SECTIONS: Record<string, string> = {
  enrollments: `SELECT e.*, c.name AS class_name FROM enrollments e JOIN classes c ON c.id = e.class_id
                WHERE e.student_id = ? ORDER BY e.id`,
  attendance: `SELECT a.status, a.note, s.date, c.name AS class_name FROM attendance a
               JOIN sessions s ON s.id = a.session_id JOIN classes c ON c.id = s.class_id
               WHERE a.student_id = ? ORDER BY s.date`,
  grades: 'SELECT * FROM grades WHERE student_id = ? ORDER BY id',
  invoices: `SELECT i.*, COALESCE((SELECT json_agg(it ORDER BY it.position) FROM invoice_items it WHERE it.invoice_id = i.id), '[]') AS items
             FROM invoices i WHERE i.student_id = ? ORDER BY i.id`,
  payments: `SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.student_id = ? ORDER BY p.id`,
  leave_requests: 'SELECT * FROM leave_requests WHERE student_id = ? ORDER BY id',
  homework_submissions: `SELECT hs.*, h.title AS homework_title FROM homework_submissions hs
                         JOIN homework h ON h.id = hs.homework_id WHERE hs.student_id = ? ORDER BY hs.id`,
  homework_scores: 'SELECT * FROM homework_scores WHERE student_id = ? ORDER BY homework_id',
  quiz_attempts: 'SELECT * FROM quiz_attempts WHERE student_id = ? ORDER BY id',
  parents: `SELECT p.id, p.name, p.phone FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
            WHERE ps.student_id = ? ORDER BY p.id`,
  notices: 'SELECT kind, status, message, created_at FROM reminders WHERE student_id = ? ORDER BY id',
};

export async function exportStudentData(
  centerId: number | null,
  id: number,
  actor?: AuditActor
): Promise<Record<string, unknown>> {
  const student = await findByIdOr404<Record<string, unknown> & { id: number; center_id: number | null }>(
    'students',
    id,
    centerId,
    'Không tìm thấy học viên'
  );
  const out: Record<string, unknown> = {
    format: 'educenter-student-export/v1',
    exported_at: new Date().toISOString(),
    student,
  };
  for (const [key, sql] of Object.entries(SECTIONS)) out[key] = await db.prepare(sql).all(id);
  await audit({
    centerId: student.center_id,
    actor,
    action: 'export',
    entity: 'students',
    entityId: id,
    summary: `Xuất dữ liệu cá nhân của học viên #${id}`,
  });
  return out;
}

/**
 * Ẩn danh học viên (không hoàn tác): tên -> "Học viên đã ẩn danh #id", xóa SĐT/email/ngày sinh/địa chỉ/ghi chú,
 * gỡ liên kết phụ huynh, xóa ghi chú điểm danh/lý do nghỉ/nội dung nhắc gửi phụ huynh. Hóa đơn, thanh toán,
 * điểm số, điểm danh giữ lại (không còn định danh được).
 */
export async function anonymizeStudent(
  centerId: number | null,
  id: number,
  actor?: AuditActor
): Promise<void> {
  const st = await findByIdOr404<{
    id: number;
    center_id: number | null;
    code: string;
    anonymized_at?: string;
  }>('students', id, centerId, 'Không tìm thấy học viên');
  if (st.anonymized_at) throw AppError.conflict('Học viên đã được ẩn danh', 'ALREADY_ANONYMIZED');
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE students SET name = ?, phone = NULL, email = NULL, dob = NULL, address = NULL, note = NULL,
           status = 'quit', anonymized_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
         WHERE id = ?`
      )
      .run(`Học viên đã ẩn danh #${id}`, id);
    await tx.prepare('DELETE FROM parent_students WHERE student_id = ?').run(id);
    await tx.prepare('UPDATE attendance SET note = NULL WHERE student_id = ?').run(id);
    await tx.prepare('UPDATE leave_requests SET reason = NULL WHERE student_id = ?').run(id);
    await tx
      .prepare('UPDATE reminders SET phone = NULL, message = NULL, response = NULL WHERE student_id = ?')
      .run(id);
    await tx.prepare("UPDATE enrollments SET status = 'inactive' WHERE student_id = ?").run(id);
  });
  await audit({
    centerId: st.center_id,
    actor,
    action: 'update',
    entity: 'students',
    entityId: id,
    summary: `Ẩn danh học viên #${id} (mã ${st.code}) theo yêu cầu xóa dữ liệu cá nhân`,
  });
}
