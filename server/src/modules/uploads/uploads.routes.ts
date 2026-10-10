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
  deleteUploadFileByUrl,
} from '../../shared/upload';

/**
 * Upload file đính kèm cho staff (giáo viên/admin có quyền giao bài).
 * File vật lý lưu ở server/uploads/ với tên do server sinh (CSPRNG), chưa gắn
 * vào bài tập nào — client gắn URL vào attachments khi lưu bài (POST/PUT /homework).
 * File không được gắn mà modal bị hủy thì client gọi DELETE để dọn dẹp.
 */
const router = Router();

/** Giáo viên tải file đính kèm lên (ảnh, PDF, Word, MP3, MP4 — tối đa 10MB) */
router.post(
  '/',
  uploadRateLimit,
  requirePermission('homework.create'),
  uploadSingle,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) throw AppError.badRequest('Chưa chọn file để tải lên');
    try {
      // E2: check magic bytes + mimetype SAU khi multer ghi đĩa (file giả → xóa + 400)
      assertSafeUpload(req.file);
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
 * Chỉ nhận tên file do server sinh — validate chặt để chống path traversal.
 */
router.delete(
  '/:filename',
  requirePermission('homework.create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const filename = req.params.filename;
    if (!isValidUploadFilename(filename)) {
      throw AppError.badRequest('Tên file không hợp lệ');
    }
    const url = `/uploads/${filename}`;
    await deleteUploadFileByUrl(url);
    await audit({
      centerId: reqCenterId(req),
      actor: actorFromReq(req),
      action: 'delete',
      entity: 'upload',
      summary: `Xóa file đính kèm chưa dùng "${filename}"`,
      meta: { filename },
    });
    res.json({ ok: true });
  })
);

export default router;
