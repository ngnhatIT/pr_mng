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
  const sub = await db.prepare(
      `SELECT hs.student_id, h.center_id FROM homework_submissions hs
       JOIN homework h ON h.id = hs.homework_id
       WHERE hs.file_url = ?`
    )
    .get(`/uploads/${safe}`) as UploadAccess | undefined;
  if (!sub) throw AppError.notFound('Không tìm thấy file');

  let allowed = false;
  if (role === 'admin' || role === 'root' || (role !== 'parent' && (userCenterId === null || userCenterId === sub.center_id))) {
    allowed = true; // staff cùng center
  } else if (role === 'parent') {
    const pid = parentId ?? userId;
    const link = await db.prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?')
      .get(pid, sub.student_id);
    allowed = !!link;
  } else if (role === 'teacher') {
    allowed = userCenterId === null || userCenterId === sub.center_id;
  }
  if (!allowed) throw AppError.forbidden('Không có quyền xem file này');
  return sub;
}
