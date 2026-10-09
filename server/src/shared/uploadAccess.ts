import { db } from '../db';
import { AppError } from './errors';
import { isValidUploadFilename } from './upload';

export interface UploadAccess {
  student_id: number;
  center_id: number | null;
}

/**
 * Kiểm tra quyền truy cập file bài nộp.
 * - Staff (admin/root/teacher/staff) cùng center được xem
 * - Parent chỉ được xem file của con mình
 * Throw 404/403 nếu không hợp lệ.
 */
export async function checkUploadAccess(
  filename: string,
  role: string | undefined,
  userCenterId: number | null,
  userId: number,
  parentId?: number
): Promise<UploadAccess> {
  const safe = filename.split('/').pop() || '';
  if (!isValidUploadFilename(safe)) {
    throw AppError.notFound('Không tìm thấy file');
  }
  const sub = (await db
    .prepare(
      `SELECT hs.student_id, h.center_id FROM homework_submissions hs
       JOIN homework h ON h.id = hs.homework_id
       WHERE hs.file_url = ?`
    )
    .get(`/uploads/${safe}`)) as UploadAccess | undefined;
  if (!sub) throw AppError.notFound('Không tìm thấy file');

  let allowed = false;
  if (role === 'superadmin') {
    allowed = true; // superadmin: toàn hệ thống
  } else if (role === 'teacher') {
    // Giáo viên chỉ xem file của học viên trong lớp mình dạy (scope 'own')
    const teacherId = (await db
      .prepare('SELECT id FROM teachers WHERE user_id = ?')
      .get(userId)) as { id: number } | undefined;
    if (teacherId) {
      const inMyClass = await db
        .prepare(
          `SELECT 1 FROM homework_submissions hs
           JOIN homework h ON h.id = hs.homework_id
           JOIN classes c ON c.id = h.class_id
           WHERE hs.file_url = ? AND c.teacher_id = ?`
        )
        .get(`/uploads/${safe}`, teacherId.id);
      allowed = !!inMyClass;
    }
  } else if (role !== 'parent' && userCenterId !== null && userCenterId === sub.center_id) {
    allowed = true; // admin/staff: chỉ file trong center của mình
  } else if (role === 'parent') {
    const pid = parentId ?? userId;
    const link = await db
      .prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
      .get(pid, sub.student_id);
    allowed = !!link;
  }
  if (!allowed) throw AppError.forbidden('Không có quyền xem file này');
  return sub;
}
