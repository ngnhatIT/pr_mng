import { db } from '../db';
import { logger } from './logger';

/**
 * Chạy fn trong khi giữ advisory lock (session-level).
 * Dùng dedicated client từ pool để lock/unlock cùng session (không leak).
 * Trả về 'locked' nếu đã có instance khác giữ, 'done' nếu chạy xong, 'error' nếu fn throw.
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<{ status: 'done' | 'locked' | 'error'; result?: T; error?: unknown }> {
  let client;
  try {
    client = await db.connect();
  } catch (error) {
    // Pool cạn/DB chết: trả error để caller log + alert, không throw ra cron
    logger.error('Không lấy được DB client cho advisory lock', { key, error: String(error) });
    return { status: 'error', error };
  }
  try {
    const r = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) as locked', [key]);
    const locked = (r.rows[0] as { locked: boolean } | undefined)?.locked === true;
    if (!locked) {
      logger.info('Bỏ qua: lock đang được giữ bởi instance khác', { key });
      return { status: 'locked' };
    }
    try {
      const result = await fn();
      return { status: 'done', result };
    } catch (error) {
      return { status: 'error', error };
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      } catch {
        /* bỏ qua */
      }
    }
  } finally {
    client.release();
  }
}
