import { db } from '../db';
import { AppError } from './errors';
import { isValidUploadFilename } from './upload';
import type { AuthUser } from '../middleware/auth';
import { getPermissionScope, type Scope } from '../modules/authorization/authorization.service';
import { targetScopeCond } from '../modules/homework/homework.helpers';

/** Dòng bài tập tham chiếu file (bài nộp hoặc đính kèm) — đủ để xét scope. */
interface FileOwnerRow {
  center_id: number | null;
  teacher_id: number | null;
}

/** Scope permission có phủ bản ghi này không (center/own theo lớp). */
function scopeCovers(
  scope: Scope | null,
  row: FileOwnerRow,
  user: AuthUser,
  userCenterId: number | null
): boolean {
  if (!scope) return false;
  if (scope === 'all') return true;
  if (userCenterId === null || row.center_id !== userCenterId) return false;
  if (scope === 'center') return true;
  // scope 'own': chỉ lớp mình dạy; teacher_id null → không khớp (fail-closed)
  return user.teacher_id != null && row.teacher_id === user.teacher_id;
}

/**
 * Kiểm tra quyền xem file trong thư mục upload (GET /uploads/:filename). Throw 404/403.
 * File có thể là bài nộp (homework_submissions), đính kèm bài tập (homework_attachments)
 * hoặc file nhân sự vừa tải lên chưa gắn bài (sổ uploads).
 * - HW-7: nhân sự xét theo permission scope (homework.grade cho bài nộp, homework.view cho
 *   đính kèm, homework.create cho file chưa gắn), không theo role literal.
 * - Phụ huynh: bài nộp của con mình; đính kèm của bài ĐÃ ĐĂNG mà con đang học lớp/được giao.
 */
export async function checkUploadAccess(filename: string, user: AuthUser): Promise<void> {
  const safe = filename.split('/').pop() || '';
  if (!isValidUploadFilename(safe)) throw AppError.notFound('Không tìm thấy file');
  const url = `/uploads/${safe}`;
  const isParent = user.kind === 'parent' || user.role === 'parent';

  if (isParent) {
    const pid = user.parent_id ?? user.id;
    const ok = await db
      .prepare(
        `SELECT 1 FROM homework_submissions hs
         JOIN parent_students ps ON ps.student_id = hs.student_id
         WHERE hs.file_url = ? AND ps.parent_id = ?
         UNION ALL
         SELECT 1 FROM homework_attachments ha
         JOIN homework h ON h.id = ha.homework_id
         JOIN enrollments e ON e.class_id = h.class_id AND e.status = 'active'
         JOIN parent_students ps ON ps.student_id = e.student_id
         WHERE ha.url = ? AND ps.parent_id = ? AND h.status = 'published'
           AND ${targetScopeCond('h', 'e.student_id')}
         LIMIT 1`
      )
      .get(url, pid, url, pid);
    if (ok) return;
    // Không lộ file có tồn tại hay không với phụ huynh khác
    throw AppError.notFound('Không tìm thấy file');
  }

  const owner = `COALESCE(h.center_id, c.center_id) as center_id, c.teacher_id`;
  const subs = (await db
    .prepare(
      `SELECT ${owner} FROM homework_submissions hs
       JOIN homework h ON h.id = hs.homework_id JOIN classes c ON c.id = h.class_id
       WHERE hs.file_url = ?`
    )
    .all(url)) as FileOwnerRow[];
  const atts = (await db
    .prepare(
      `SELECT ${owner} FROM homework_attachments ha
       JOIN homework h ON h.id = ha.homework_id JOIN classes c ON c.id = h.class_id
       WHERE ha.url = ?`
    )
    .all(url)) as FileOwnerRow[];
  const up = (await db.prepare('SELECT center_id, uploaded_by FROM uploads WHERE filename = ?').get(safe)) as
    { center_id: number | null; uploaded_by: number | null } | undefined;
  if (!subs.length && !atts.length && !up) throw AppError.notFound('Không tìm thấy file');

  // Fail-closed: nhân sự không phải superadmin mà thiếu center → không thấy gì
  const userCenterId = user.role === 'superadmin' ? null : (user.center_id ?? null);
  if (user.role !== 'superadmin' && userCenterId === null)
    throw AppError.forbidden('Không có quyền xem file này');

  if (subs.length) {
    const scope = await getPermissionScope(user.id, 'homework.grade');
    if (subs.some((r) => scopeCovers(scope, r, user, userCenterId))) return;
  }
  if (atts.length) {
    const scope = await getPermissionScope(user.id, 'homework.view');
    if (atts.some((r) => scopeCovers(scope, r, user, userCenterId))) return;
  }
  if (up) {
    // File vừa tải lên chưa gắn bài: người tải, hoặc nhân sự scope center/all cùng trung tâm
    if (up.uploaded_by === user.id) return;
    const scope = await getPermissionScope(user.id, 'homework.create');
    if (scope === 'all' || (scope === 'center' && up.center_id !== null && up.center_id === userCenterId))
      return;
  }
  throw AppError.forbidden('Không có quyền xem file này');
}
