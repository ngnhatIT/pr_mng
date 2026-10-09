import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Request ID middleware — chuẩn observability production.
 * - Mỗi request có ID duy nhất để trace qua logs
 * - Trả về client qua header X-Request-Id để debug
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID().slice(0, 8);
  (req as Request & { requestId: string }).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** Lấy request ID từ request (để logger). */
export function getRequestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId || '-';
}
