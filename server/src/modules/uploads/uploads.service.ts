import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import { deleteUploadFileByUrl, isUploadReferenced } from '../../shared/upload';
import { getPermissionScope } from '../authorization/authorization.service';

/**
 * Xóa file đã upload nhưng chưa gắn vào bài nào.
 * HW-6: chỉ file có trong sổ uploads, do chính mình tải hoặc nhân sự scope center/all
 * cùng trung tâm, và CHƯA được đính kèm/bài nộp nào tham chiếu.
 */
export async function deleteUnusedUpload(
  centerId: number | null,
  userId: number,
  filename: string,
  actor: AuditActor
): Promise<void> {
  const up = (await db
    .prepare('SELECT center_id, uploaded_by FROM uploads WHERE filename = ?')
    .get(filename)) as { center_id: number | null; uploaded_by: number | null } | undefined;
  if (!up) throw AppError.notFound('Không tìm thấy file');
  if (up.uploaded_by !== userId) {
    const scope = await getPermissionScope(userId, 'homework.create');
    const sameCenter =
      scope === 'all' || (scope === 'center' && centerId !== null && up.center_id === centerId);
    if (!sameCenter) throw AppError.notFound('Không tìm thấy file');
  }
  const url = `/uploads/${filename}`;
  if (await isUploadReferenced(url)) {
    throw AppError.conflict('File đang được dùng trong bài tập hoặc bài nộp, không thể xóa');
  }
  await deleteUploadFileByUrl(url);
  await audit({
    centerId,
    actor,
    action: 'delete',
    entity: 'upload',
    summary: `Xóa file đính kèm chưa dùng "${filename}"`,
    meta: { filename },
  });
}
