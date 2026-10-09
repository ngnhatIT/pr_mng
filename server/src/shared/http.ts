import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errors';
import { logger } from './logger';

/**
 * Bọc async route handler để mọi exception (kể cả promise rejection)
 * tự chảy về errorHandler tập trung — không cần try/catch trong từng route.
 *
 * Trước:  router.get('/', (req, res) => { try { ... } catch { res.status(500)... } })
 * Sau:    router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware xử lý lỗi tập trung — ĐẶT CUỐI CÙNG sau mọi route.
 * - AppError  -> trả đúng statusCode + message thân thiện
 * - Lỗi lạ    -> 500 "Lỗi máy chủ", log chi tiết ra console (không lộ cho client)
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  // Lỗi upload từ multer: file quá lớn → 413 với message rõ ràng
  const code = (err as { code?: string })?.code;
  if (code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File vượt quá 10MB', code: 'FILE_TOO_LARGE' });
    return;
  }
  if (code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: 'File không hợp lệ', code: 'INVALID_FILE' });
    return;
  }
  // Lỗi không lường trước: log để debug, client chỉ thấy message chung
  logger.error('Unhandled error', { error: err instanceof Error ? err.stack || err.message : String(err) });
  res.status(500).json({ error: 'Lỗi máy chủ', code: 'INTERNAL_ERROR' });
}

/** 404 cho API không tồn tại — đặt sau mọi route, trước errorHandler. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'API không tồn tại', code: 'NOT_FOUND' });
}
