import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { requireAuth, denyParents, superadminOnly } from '../../middleware/auth';
import { env } from '../../config/env';
import { db, getPoolStats } from '../../db';
import { asyncHandler } from '../../shared/http';
import { logger } from '../../shared/logger';

/**
 * Metrics endpoint — chuẩn observability enterprise.
 * Format tương thích Prometheus text exposition (đơn giản).
 * Dùng cho monitoring: request count, DB size, uptime...
 */
const router = Router();

// Đếm request theo route (in-memory, reset khi restart)
const requestCounts = new Map<string, number>();
/** Trần số series — phòng hờ route pattern động; vượt thì gộp vào 'other'. */
const MAX_ROUTES = 500;

export function trackRequest(route: string): void {
  const key = requestCounts.has(route) || requestCounts.size < MAX_ROUTES ? route : 'other';
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
}

/** Escape label value theo Prometheus text format (\\, ", xuống dòng). */
function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** OPS-5: Bearer == METRICS_TOKEN (so sánh constant-time) cho Prometheus. Rỗng = tắt. */
export function isMetricsToken(header: string | undefined, token = env.METRICS_TOKEN): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// SEC-3: số liệu toàn nền tảng — METRICS_TOKEN hoặc JWT superadmin (admin trung tâm có system.manage scope center)
function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  if (isMetricsToken(req.headers.authorization)) return next();
  requireAuth(req, res, () => denyParents(req, res, () => superadminOnly(req, res, next)));
}

router.get(
  '/',
  metricsAuth,
  asyncHandler(async (_req, res) => {
    const mem = process.memoryUsage();
    let dbSize = 0;
    let tableCount = 0;
    try {
      // PostgreSQL: dùng pg_database_size + information_schema (không còn PRAGMA/sqlite_master)
      const sizeRow = (await db
        .query('SELECT pg_database_size(current_database()) as size')
        .then((r) => r.rows[0])) as {
        size: string;
      };
      dbSize = Number(sizeRow?.size) || 0;
      const tableRow = (await db
        .query(
          "SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        )
        .then((r) => r.rows[0])) as { c: string };
      tableCount = Number(tableRow?.c) || 0;
    } catch (err) {
      // Không để metrics hỏng vì lỗi DB — endpoint vẫn trả các metric còn lại
      logger.scope('metrics').warn('db metrics failed', { error: String(err) });
    }

    // OPS-5: PM2 cluster — mỗi scrape rơi vào 1 worker; label worker để counter không nhảy giữa các worker
    const w = `worker="${escapeLabel(process.env.NODE_APP_INSTANCE ?? '0')}"`;
    const lines = [
      '# HELP educenter_uptime_seconds Thời gian server chạy (giây)',
      '# TYPE educenter_uptime_seconds gauge',
      `educenter_uptime_seconds{${w}} ${Math.round(process.uptime())}`,
      '# HELP educenter_memory_heap_bytes Bộ nhớ heap đang dùng',
      '# TYPE educenter_memory_heap_bytes gauge',
      `educenter_memory_heap_bytes{${w}} ${mem.heapUsed}`,
      '# HELP educenter_db_size_bytes Kích thước file DB',
      '# TYPE educenter_db_size_bytes gauge',
      `educenter_db_size_bytes{${w}} ${dbSize}`,
      '# HELP educenter_db_tables Số bảng trong DB',
      '# TYPE educenter_db_tables gauge',
      `educenter_db_tables{${w}} ${tableCount}`,
    ];
    // Request counts theo route
    lines.push('# HELP educenter_http_requests_total Tổng số request theo route');
    lines.push('# TYPE educenter_http_requests_total counter');
    for (const [route, count] of requestCounts) {
      lines.push(`educenter_http_requests_total{route="${escapeLabel(route)}",${w}} ${count}`);
    }
    // Pool stats — phát hiện cạn connection
    const poolStats = getPoolStats();
    lines.push('# HELP educenter_db_pool_total Tổng connection trong pool');
    lines.push('# TYPE educenter_db_pool_total gauge');
    lines.push(`educenter_db_pool_total{${w}} ${poolStats.total}`);
    lines.push('# HELP educenter_db_pool_idle Connection rảnh');
    lines.push('# TYPE educenter_db_pool_idle gauge');
    lines.push(`educenter_db_pool_idle{${w}} ${poolStats.idle}`);
    lines.push('# HELP educenter_db_pool_waiting Request đang chờ connection');
    lines.push('# TYPE educenter_db_pool_waiting gauge');
    lines.push(`educenter_db_pool_waiting{${w}} ${poolStats.waiting}`);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  })
);

export default router;
