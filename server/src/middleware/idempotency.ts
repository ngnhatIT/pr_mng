import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { formatError } from '../shared/errorFormat';
import { db } from '../db';
import { logger } from '../shared/logger';

const log = logger.scope('idempotency');

/**
 * Idempotency-Key: chống double-submit tạo dữ liệu trùng (phiếu thu, thanh toán, hoàn tiền).
 *
 * Client gửi header `Idempotency-Key: <uuid>`. Server GIỮ CHỖ key NGUYÊN TỬ trước khi chạy handler
 * (INSERT ... ON CONFLICT DO NOTHING RETURNING), key gắn với (user, key):
 * - Giữ chỗ được → chạy handler. 2xx: lưu response (status 'done') TRƯỚC khi gửi đi.
 *   Lỗi/không 2xx: xóa chỗ giữ để client thử lại được.
 * - Key đã có, khác method/path/body → 422 (dùng lại key cho thao tác khác).
 * - Key đang 'processing' (request trùng đang chạy song song) → 409.
 * - Key 'done' → trả lại response cũ, không xử lý lại.
 * Key quá 24h được cron hourly trong index.ts dọn (không DELETE mỗi request).
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
  const user = (req as { user?: { id?: number; role?: string } }).user;
  const userKey = user?.id != null ? `${user.id}:${user.role ?? ''}` : 'anon';
  const path = req.baseUrl + req.path;
  const bodyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');

  try {
    const reserved = await db
      .prepare(
        `INSERT INTO idempotency_keys (user_key, key, method, path, body_hash, status)
         VALUES (?, ?, ?, ?, ?, 'processing') ON CONFLICT (user_key, key) DO NOTHING RETURNING key`
      )
      .get(userKey, key, req.method, path, bodyHash);

    if (!reserved) {
      const row = (await db
        .prepare(
          'SELECT method, path, body_hash, status, status_code, response_body FROM idempotency_keys WHERE user_key = ? AND key = ?'
        )
        .get(userKey, key)) as
        | {
            method: string;
            path: string;
            body_hash: string;
            status: string;
            status_code: number | null;
            response_body: string | null;
          }
        | undefined;
      if (row && (row.method !== req.method || row.path !== path || row.body_hash !== bodyHash)) {
        res.status(422).json({
          error: 'Idempotency-Key đã dùng cho một thao tác khác',
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
        return;
      }
      if (!row || row.status !== 'done' || row.status_code == null) {
        // Request trùng đang chạy (hoặc vừa thất bại và đang nhả key) — client thử lại sau
        res
          .status(409)
          .json({ error: 'Yêu cầu đang được xử lý, vui lòng đợi', code: 'IDEMPOTENCY_IN_PROGRESS' });
        return;
      }
      log.info('Idempotency hit', { key, path });
      res.status(row.status_code).json(row.response_body ? JSON.parse(row.response_body) : null);
      return;
    }
  } catch (err) {
    // DB lỗi ở bước giữ chỗ: KHÔNG cho chạy tiếp (luồng tiền — thà báo lỗi còn hơn ghi trùng)
    log.error('Giữ chỗ idempotency key thất bại', { error: formatError(err) });
    next(err);
    return;
  }

  let settled = false;
  const release = () =>
    db
      .prepare('DELETE FROM idempotency_keys WHERE user_key = ? AND key = ?')
      .run(userKey, key)
      .catch((err: unknown) => log.warn('Nhả idempotency key thất bại', { error: formatError(err) }));

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (settled) return originalJson(body);
    settled = true;
    // Ghi DB TRƯỚC khi gửi: retry ngay sau response luôn thấy 'done' (replay) hoặc key đã nhả (chạy lại)
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const op = ok
      ? db
          .prepare(
            `UPDATE idempotency_keys SET status = 'done', status_code = ?, response_body = ?
             WHERE user_key = ? AND key = ?`
          )
          .run(res.statusCode, JSON.stringify(body ?? null), userKey, key)
          .catch((err: unknown) => log.warn('Lưu idempotency key thất bại', { error: formatError(err) }))
      : release();
    void op.finally(() => originalJson(body));
    return res;
  }) as typeof res.json;
  // Response không đi qua res.json (send/end) -> nhả key. KHÔNG nhả khi client ngắt kết nối giữa chừng:
  // handler vẫn chạy và sẽ lưu 'done' — nhả sớm thì retry của proxy chạy lại thao tác lần 2.
  // ponytail: process chết giữa handler -> key kẹt 'processing' tới khi cron dọn (24h); client sinh key mới.
  res.on('finish', () => {
    if (!settled) {
      settled = true;
      void release();
    }
  });

  next();
}
