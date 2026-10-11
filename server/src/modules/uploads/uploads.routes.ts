import { Router, Response } from 'express';
import { AuthRequest, reqCenterId } from '../../middleware/auth';
import { requirePermission } from '../authorization/authorization.middleware';
import { asyncHandler } from '../../shared/http';
import { AppError } from '../../shared/errors';
import { audit, actorFromReq } from '../../shared/audit';
import { uploadRateLimit } from '../../middleware/rateLimit';
import {
  uploadSingle,
  assertSafeUpload,
  cleanupUploadedFile,
  isValidUploadFilename,
  recordUpload,
} from '../../shared/upload';
import { deleteUnusedUpload } from './uploads.service';

/**
 * Upload file đính kèm cho staff (giáo viên/admin có quyền giao bài).
 * File vật lý lưu ở server/uploads/ với tên do server sinh (CSPRNG), chưa gắn
 * vào bài tập nào — client gắn URL vào attachments khi lưu bài (POST/PUT /homework).
 * File không được gắn mà modal bị hủy thì client gọi DELETE để dọn dẹp.
 * HW-6: mỗi file ghi vào sổ `uploads` (trung tâm + người tải) — DELETE và gắn đính kèm
 * kiểm quyền theo sổ này; file chưa gắn quá 24h được sweeper dọn (HW-16).
 */
const router = Router();

/** Giáo viên tải file đính kèm lên (ảnh, PDF, Word, MP3, MP4 — tối đa 10MB) */
router.post(
  '/',
  uploadRateLimit,
  requirePermission('homework.create', 'own'),
  uploadSingle,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) throw AppError.badRequest('Chưa chọn file để tải lên');
    try {
      // E2: check magic bytes + mimetype SAU khi multer ghi đĩa (file giả → xóa + 400)
      assertSafeUpload(req.file);
      await recordUpload(`/uploads/${req.file.filename}`, reqCenterId(req), req.user!.id);
      await audit({
        centerId: reqCenterId(req),
        actor: actorFromReq(req),
        action: 'create',
        entity: 'upload',
        summary: `Tải file đính kèm "${req.file.originalname}" (${Math.round(req.file.size / 1024)} KB)`,
        meta: { name: req.file.originalname, size: req.file.size, url: `/uploads/${req.file.filename}` },
      });
      res.status(201).json({
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        size: req.file.size,
      });
    } catch (err) {
      // Nghiệp vụ thất bại (vd: audit lỗi) → xóa file vừa ghi để khỏi mồ côi
      cleanupUploadedFile(req.file);
      throw err;
    }
  })
);

/**
 * Xóa file đã upload nhưng chưa gắn vào bài nào (user gỡ khỏi form hoặc hủy modal).
 * HW-6: chỉ file có trong sổ uploads, do chính mình tải hoặc nhân sự scope center/all
 * cùng trung tâm, và CHƯA được đính kèm/bài nộp nào tham chiếu.
 */
router.delete(
  '/:filename',
  requirePermission('homework.create', 'own'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const filename = req.params.filename;
    if (!isValidUploadFilename(filename)) {
      throw AppError.badRequest('Tên file không hợp lệ');
    }
    await deleteUnusedUpload(reqCenterId(req), req.user!.id, filename, actorFromReq(req));
    res.json({ ok: true });
  })
);

export default router;
