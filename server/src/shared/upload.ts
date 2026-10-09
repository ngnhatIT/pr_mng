import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { AppError } from './errors';

/**
 * Cấu hình upload file dùng chung (bài nộp của học viên).
 * - File lưu vào server/uploads/ với tên do server sinh (chống path traversal)
 * - Giới hạn 10MB, chỉ nhận ảnh/PDF/Word/MP3/MP4
 */

// Thư mục upload: server/uploads (tính từ dist/modules/<module>/)
export function getUploadDir(): string {
  const dir = path.resolve(__dirname, '..', '..', '..', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_EXT = /\.(jpg|jpeg|png|gif|webp|pdf|mp3|mp4|doc|docx)$/i;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getUploadDir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // M13: UUID v4 (CSPRNG) thay vì Math.random() — tên file khó đoán, chống brute-force khi kết hợp C3
    cb(null, `hw_${crypto.randomUUID()}${ext}`);
  },
});

export const uploadSingle = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXT.test(file.originalname)) {
      cb(new AppError(400, 'Định dạng file không hỗ trợ. Chỉ nhận: ảnh, PDF, Word, MP3, MP4'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/** Xóa file đã upload khi nghiệp vụ thất bại (tránh rác trên đĩa). */
export function cleanupUploadedFile(file: { path: string } | undefined): void {
  if (file?.path) {
    fs.unlink(file.path, () => {
      /* bỏ qua lỗi */
    });
  }
}

/** Kiểm tra tên file hợp lệ (do server sinh). Chấp nhận cả định dạng cũ và UUID mới. */
export function isValidUploadFilename(filename: string): boolean {
  return /^hw_(?:\d+_[a-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/i.test(
    path.basename(filename)
  );
}

/**
 * Xóa file vật lý theo URL lưu trong DB (vd: '/uploads/hw_xxx.pdf').
 * Dùng khi xóa bản ghi (homework, submission, student...) để không để lại file mồ côi.
 */
export async function deleteUploadFileByUrl(url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith('/uploads/')) return;
  const filename = path.basename(url);
  // Chống path traversal: chỉ cho phép tên file đơn giản
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return;
  try {
    await fs.promises.unlink(path.join(getUploadDir(), filename));
  } catch {
    // File đã mất hoặc không xóa được — không chặn xóa DB
  }
}
