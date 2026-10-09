import { Router, Request, Response } from 'express';
import { db } from '../../db';
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
  asyncHandler(async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    let dbSize = 0;
    let tableCount = 0;
    try {
      const pageCount = (await db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
      const pageSize = (await db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
      dbSize = pageCount * pageSize;
      tableCount = (await db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table'").get() as { c: number }).c;
    } catch {
      /* bỏ qua */
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

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  })
);

export default router;
