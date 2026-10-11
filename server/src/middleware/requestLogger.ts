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
    // PERF-1: chỉ dùng route pattern; request không khớp route (401/404/429 ở mount, scanner) gộp
    // về 'unmatched' — dùng req.path thô làm Map/series Prometheus phình vô hạn.
    const route = req.route?.path
      ? `${req.method} ${req.baseUrl}${req.route.path}`
      : `${req.method} unmatched`;
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
