import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger';
import { getRequestId } from './requestId';
import { trackRequest } from '../modules/metrics/metrics.routes';

const log = logger.scope('http');

/**
 * HTTP request logging — production mù về lưu lượng nếu không có.
 * Log: method, path, status, duration_ms, request_id. Bỏ qua /health để đỡ ồn.
 * Đồng thời đếm request cho /metrics (trước đây trackRequest là dead code).
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/api/health') return;
    const route = `${req.method} ${req.baseUrl}${req.route?.path || req.path}`;
    trackRequest(route);
    log.info('HTTP', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      request_id: getRequestId(req),
    });
  });
  next();
}
