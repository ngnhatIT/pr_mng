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

/**
 * E2: Chữ ký magic bytes theo đuôi file (đọc 16 byte đầu).
 * fileFilter của multer chạy TRƯỚC khi file ghi xuống đĩa (multer 2.x: `stream`
 * chưa có ở fileFilter) nên check nội dung phải làm sau upload — xem assertSafeUpload.
 * Mỗi rule là 1 phương án, mỗi phương án gồm các (offset, bytes) đều phải khớp.
 */
type MagicRule = Array<{ offset: number; bytes: number[] }>;
const MAGIC: Record<string, MagicRule[]> = {
  jpg: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  jpeg: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  png: [[{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }]],
  gif: [[{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }]], // GIF8
  webp: [
    [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
    ],
  ],
  pdf: [[{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }]], // %PDF
  mp3: [
    [{ offset: 0, bytes: [0x49, 0x44, 0x33] }], // ID3
    [{ offset: 0, bytes: [0xff, 0xfb] }], // frame sync MPEG-1
    [{ offset: 0, bytes: [0xff, 0xf3] }], // frame sync MPEG-2
    [{ offset: 0, bytes: [0xff, 0xf2] }], // frame sync MPEG-2.5
  ],
  mp4: [[{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }]], // ....ftyp
  doc: [[{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0] }]], // OLE
  docx: [[{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }]], // ZIP
};

/** Lớp 2: mimetype client khai báo phải khớp đuôi file (chống đổi đuôi đơn giản). */
const EXT_MIME: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  mp4: ['video/mp4'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

/** Kiểm tra magic bytes của buffer (16 byte đầu) có khớp đuôi file không. Hàm thuần — dễ test. */
export function hasAllowedMagic(head: Buffer, ext: string): boolean {
  const rules = MAGIC[ext.toLowerCase()];
  if (!rules) return false;
  return rules.some((rule) =>
    rule.every(({ offset, bytes }) => bytes.every((b, i) => head[offset + i] === b))
  );
}

/**
 * E2: Kiểm tra file đã upload có nội dung đúng định dạng không.
 * Gọi SAU khi multer ghi file xong (route handler), vì fileFilter chạy trước khi ghi đĩa.
 * File không đạt → xóa ngay khỏi đĩa + throw 400.
 */
export function assertSafeUpload(file: { path: string; originalname: string; mimetype: string }): void {
  const fail = (reason: string): never => {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* bỏ qua */
    }
    throw new AppError(400, reason);
  };
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  let head: Buffer;
  try {
    const fd = fs.openSync(file.path, 'r');
    try {
      head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return fail('Không đọc được file vừa tải lên');
  }
  if (!hasAllowedMagic(head, ext)) {
    return fail('Nội dung file không đúng định dạng cho phép (chỉ nhận ảnh, PDF, Word, MP3, MP4 thật)');
  }
  const allowed = EXT_MIME[ext] ?? [];
  if (allowed.length > 0 && !allowed.includes(file.mimetype.toLowerCase())) {
    return fail('Loại file khai báo không khớp với định dạng cho phép');
  }
}

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
