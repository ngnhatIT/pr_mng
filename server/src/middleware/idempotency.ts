import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { logger } from '../shared/logger';

const log = logger.scope('idempotency');

const IDEMPOTENCY_TTL_HOURS = 24;

/**
 * Idempotency-Key: chống double-submit tạo dữ liệu trùng.
 *
 * Client gửi header `Idempotency-Key: <uuid>` với POST. Server:
 * - Key chưa dùng → xử lý bình thường, lưu kết quả với key
 * - Key đã dùng → trả lại kết quả cũ (không xử lý lại)
 *
 * Áp dụng cho: tạo phiếu thu, tạo thanh toán (luồng tiền).
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.get('Idempotency-Key');
  if (!key) {
    next();
    return;
  }
  // Validate key format (UUID-ish, chống injection)
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(key)) {
    res.status(400).json({ error: 'Idempotency-Key không hợp lệ', code: 'INVALID_IDEMPOTENCY_KEY' });
    return;
  }

  try {
    // Dọn key cũ (quá TTL) — best effort
    await db
      .prepare(
        `DELETE FROM idempotency_keys WHERE created_at < to_char(NOW() - INTERVAL '${IDEMPOTENCY_TTL_HOURS} hours', 'YYYY-MM-DD HH24:MI:SS')`
      )
      .run();

    const existing = (await db
      .prepare('SELECT status_code, response_body FROM idempotency_keys WHERE key = ?')
      .get(key)) as { status_code: number; response_body: string } | undefined;

    if (existing) {
      // Trả lại kết quả cũ
      log.info('Idempotency hit', { key, path: req.path });
      res.status(existing.status_code).json(JSON.parse(existing.response_body));
      return;
    }

    // Chưa có: wrap res.json để lưu kết quả
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      // Chỉ lưu khi thành công (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = (req as { user?: { id?: number } }).user?.id ?? null;
        db.prepare(
          'INSERT INTO idempotency_keys (key, user_id, method, path, status_code, response_body) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING'
        )
          .run(key, userId, req.method, req.path, res.statusCode, JSON.stringify(body))
          .catch((err: unknown) => log.warn('Lưu idempotency key thất bại', { error: String(err) }));
      }
      return originalJson(body);
    }) as typeof res.json;

    next();
  } catch (err) {
    log.warn('Idempotency check thất bại, cho qua', { error: String(err) });
    next();
  }
}
