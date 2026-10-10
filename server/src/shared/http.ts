import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errors';
import { logger } from './logger';
import { getRequestId } from '../middleware/requestId';

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
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = getRequestId(req);
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, request_id: requestId });
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
  // Lỗi parse body từ express.json: JSON sai cú pháp → 400, payload >1mb → 413
  // (không để rơi xuống 500 "Lỗi máy chủ" khiến client không phân biệt được)
  const errType = (err as { type?: string })?.type;
  if (errType === 'entity.parse.failed') {
    res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ', code: 'INVALID_JSON', request_id: requestId });
    return;
  }
  if (errType === 'entity.too.large') {
    res
      .status(413)
      .json({ error: 'Dữ liệu gửi lên vượt quá 1MB', code: 'PAYLOAD_TOO_LARGE', request_id: requestId });
    return;
  }
  // Lỗi PostgreSQL: dịch mã lỗi thành response thân thiện
  if (code === '23505') {
    res.status(409).json({ error: 'Dữ liệu đã tồn tại (trùng lặp)', code: 'DUPLICATE' });
    return;
  }
  if (code === '23503') {
    res.status(409).json({ error: 'Dữ liệu liên quan không tồn tại', code: 'FK_VIOLATION' });
    return;
  }
  if (code === '22P02') {
    res.status(400).json({ error: 'Định dạng dữ liệu không hợp lệ', code: 'INVALID_FORMAT' });
    return;
  }
  // Lỗi không lường trước: log để debug (kèm requestId để trace), client chỉ thấy message chung + mã lỗi
  logger.error('Unhandled error', {
    error: err instanceof Error ? err.stack || err.message : String(err),
    requestId,
  });
  res.status(500).json({ error: 'Lỗi máy chủ', code: 'INTERNAL_ERROR', request_id: requestId });
}

/** 404 cho API không tồn tại — đặt sau mọi route, trước errorHandler. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'API không tồn tại', code: 'NOT_FOUND' });
}
