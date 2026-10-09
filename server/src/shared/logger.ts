/**
 * Logger chuẩn của ứng dụng — thay thế console.log/error rải rác.
 *
 * - Log có level (debug/info/warn/error), timestamp, scope
 * - Production: chỉ info trở lên; development: hiện cả debug
 * - Format 1 dòng, dễ grep trong log file
 *
 * Ví dụ:
 *   import { logger } from '../../shared/logger';
 *   const log = logger.scope('payments');
 *   log.info('Đã duyệt thanh toán', { paymentId: 1 });
 */
import { env } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: Level = env.IS_PROD ? 'info' : 'debug';

function format(level: Level, scope: string, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}][${level.toUpperCase()}][${scope}] ${message}${metaStr}`;
}

function write(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const line = format(level, scope, message, meta);
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => write('debug', scope, message, meta),
    info: (message, meta) => write('info', scope, message, meta),
    warn: (message, meta) => write('warn', scope, message, meta),
    error: (message, meta) => write('error', scope, message, meta),
  };
}

export const logger = {
  scope: createLogger,
  /** Logger mặc định khi không cần scope riêng. */
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', 'app', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', 'app', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', 'app', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', 'app', message, meta),
};
