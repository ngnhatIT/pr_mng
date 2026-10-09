import { Router } from 'express';
import { requirePermission } from '../authorization/authorization.middleware';
import { db, getPoolStats } from '../../db';
import { asyncHandler } from '../../shared/http';

/**
 * Metrics endpoint — chuẩn observability enterprise.
 * Format tương thích Prometheus text exposition (đơn giản).
 * Dùng cho monitoring: request count, DB size, uptime...
 */
const router = Router();

// Đếm request theo route (in-memory, reset khi restart)
const requestCounts = new Map<string, number>();

export function trackRequest(route: string): void {
  requestCounts.set(route, (requestCounts.get(route) ?? 0) + 1);
}

router.get(
  '/',
  requirePermission('system.manage'),
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
      const { logger } = await import('../../shared/logger');
      logger.scope('metrics').warn('db metrics failed', { error: String(err) });
    }

    const lines = [
      '# HELP educenter_uptime_seconds Thời gian server chạy (giây)',
      '# TYPE educenter_uptime_seconds gauge',
      `educenter_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP educenter_memory_heap_bytes Bộ nhớ heap đang dùng',
      '# TYPE educenter_memory_heap_bytes gauge',
      `educenter_memory_heap_bytes ${mem.heapUsed}`,
      '# HELP educenter_db_size_bytes Kích thước file DB',
      '# TYPE educenter_db_size_bytes gauge',
      `educenter_db_size_bytes ${dbSize}`,
      '# HELP educenter_db_tables Số bảng trong DB',
      '# TYPE educenter_db_tables gauge',
      `educenter_db_tables ${tableCount}`,
    ];
    // Request counts theo route
    lines.push('# HELP educenter_http_requests_total Tổng số request theo route');
    lines.push('# TYPE educenter_http_requests_total counter');
    for (const [route, count] of requestCounts) {
      lines.push(`educenter_http_requests_total{route="${route}"} ${count}`);
    }
    // Pool stats — phát hiện cạn connection
    const poolStats = getPoolStats();
    lines.push('# HELP educenter_db_pool_total Tổng connection trong pool');
    lines.push('# TYPE educenter_db_pool_total gauge');
    lines.push(`educenter_db_pool_total ${poolStats.total}`);
    lines.push('# HELP educenter_db_pool_idle Connection rảnh');
    lines.push('# TYPE educenter_db_pool_idle gauge');
    lines.push(`educenter_db_pool_idle ${poolStats.idle}`);
    lines.push('# HELP educenter_db_pool_waiting Request đang chờ connection');
    lines.push('# TYPE educenter_db_pool_waiting gauge');
    lines.push(`educenter_db_pool_waiting ${poolStats.waiting}`);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  })
);

export default router;
