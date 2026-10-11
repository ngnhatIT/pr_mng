/**
 * API layer cho feature Nhắc học phí qua Zalo.
 */
import { http, type Paginated } from '../../shared/api/client';
import { ZaloConfig, ReminderItem } from '../../shared/types';

export interface ZaloTestResult {
  demo: boolean;
  status: string;
  message: string;
}

export const zaloApi = {
  getConfig: () => http.get<ZaloConfig>('/zalo/config'),
  saveConfig: (config: Partial<ZaloConfig>) => http.put<ZaloConfig>('/zalo/config', config),
  test: (phone: string) => http.post<ZaloTestResult>('/zalo/test', { phone }),
  runOnce: () => http.post<{ message: string }>('/zalo/run-once'),
  history: (limit = 100) => http.get<ReminderItem[]>(`/reminders?limit=${limit}`),
};

/* ------------------------- Chuông thông báo (staff + phụ huynh) ------------------------- */

export interface InAppNotification {
  id: number;
  kind: string;
  params: Record<string, unknown>;
  title: string | null;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  class_id: number | null;
  class_name: string | null;
  recipient_count: number;
  created_at: string;
  created_by_name: string | null;
}

/** Sự kiện window: số chưa đọc vừa đổi ở nơi khác (trang thông báo) -> chuông tải lại số. */
export const INBOX_CHANGED = 'edu:inbox-changed';

export const inboxApi = {
  list: (q: { page?: number; limit?: number; unread?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set('page', String(q.page));
    if (q.limit) p.set('limit', String(q.limit));
    if (q.unread) p.set('unread', '1');
    return http.get<Paginated<InAppNotification> & { unread: number }>(`/notifications?${p}`);
  },
  unreadCount: () => http.get<{ unread: number }>('/notifications/unread-count'),
  read: (id: number) => http.post<{ ok: boolean }>(`/notifications/${id}/read`),
  readAll: () => http.post<{ updated: number }>('/notifications/read-all'),
};

export const announcementsApi = {
  list: (page = 1) => http.get<Paginated<Announcement>>(`/announcements?page=${page}`),
  create: (body: { title: string; body: string; class_id?: number }) =>
    http.post<{ id: number; recipient_count: number }>('/announcements', body),
};
