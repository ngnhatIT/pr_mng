/**
 * API layer cho feature Nhắc học phí qua Zalo.
 */
import { http } from '../../shared/api/client';
import { ZaloConfig, ReminderItem } from '../../shared/types';

export interface ZaloTestResult {
  demo: boolean;
  status: string;
  message: string;
}

export const zaloApi = {
  getConfig: () => http.get<ZaloConfig>('/zalo/config'),
  saveConfig: (config: ZaloConfig) => http.put<ZaloConfig>('/zalo/config', config),
  test: (phone: string) => http.post<ZaloTestResult>('/zalo/test', { phone }),
  runOnce: () => http.post<{ message: string }>('/zalo/run-once'),
  history: (limit = 100) => http.get<ReminderItem[]>(`/reminders?limit=${limit}`),
};
