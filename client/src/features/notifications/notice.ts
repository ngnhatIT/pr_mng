import type { TFunction } from 'i18next';
import { formatDate, formatVND } from '../../shared/types';
import type { InAppNotification } from './notifications.api';

const DATE_KEYS = new Set(['date', 'from', 'to']);

/** Câu hiển thị của 1 thông báo: soạn tay (announcement) giữ nguyên; hệ thống dịch theo kind + params. */
export function noticeText(n: InAppNotification, t: TFunction): { title: string; body: string } {
  if (n.kind === 'announcement') return { title: n.title ?? '', body: n.body ?? '' };
  const key = `notifications.kinds.${n.kind}`;
  if (!t(key, { ns: 'common', defaultValue: '' })) return { title: n.title ?? '', body: n.body ?? '' };
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.params ?? {})) {
    params[k] =
      k === 'amount' ? formatVND(Number(v)) : DATE_KEYS.has(k) && typeof v === 'string' ? formatDate(v) : v;
  }
  return {
    title: '',
    body: String(t(key, { ns: 'common', ...params, interpolation: { escapeValue: false } })),
  };
}

/** "5 phút trước" theo ngôn ngữ app; created_at là giờ VN dạng 'YYYY-MM-DD HH:MM:SS'. */
export function timeAgo(createdAt: string, locale: string, now = Date.now()): string {
  const ms = Date.parse(`${createdAt.replace(' ', 'T')}+07:00`);
  if (Number.isNaN(ms)) return createdAt;
  const s = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return formatDate(createdAt);
}
