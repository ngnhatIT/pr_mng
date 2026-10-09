import { logger } from './logger';
import { env } from '../config/env';

const log = logger.scope('alert');

/**
 * Gửi cảnh báo vận hành qua webhook (Telegram/Slack/Discord...).
 * Cấu hình: ALERT_WEBHOOK_URL (optional). Không có URL → chỉ log.
 * Không bao giờ throw (alert không được làm hỏng flow chính).
 */
export async function sendAlert(title: string, detail: string): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  log.error('ALERT: ' + title, { detail });
  if (!url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 [EduCenterPro] ${title}\n${detail}\nThời gian: ${new Date().toISOString()}`,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    log.warn('Gửi alert webhook thất bại', { error: String(err) });
  }
}
