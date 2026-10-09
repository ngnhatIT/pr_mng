/**
 * API layer cho Nhật ký hoạt động (audit log) - chỉ admin.
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';

export interface AuditLog {
  id: number;
  center_id: number | null;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  summary: string;
  meta: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditFilter {
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
}

export const ACTION_LABEL: Record<string, string> = {
  create: 'Tạo mới',
  update: 'Cập nhật',
  delete: 'Xóa',
  approve: 'Duyệt',
  reject: 'Từ chối',
  payment: 'Thu tiền',
  apply_credit: 'Trừ credit',
  login: 'Đăng nhập',
};

export const ENTITY_LABEL: Record<string, string> = {
  invoices: 'Phiếu thu',
  payments: 'Thanh toán',
  students: 'Học viên',
  teachers: 'Giáo viên',
  classes: 'Lớp học',
};

export const auditApi = {
  list: (filter: AuditFilter = {}, page?: PageParams) => {
    const q = new URLSearchParams();
    if (filter.action) q.set('action', filter.action);
    if (filter.entity) q.set('entity', filter.entity);
    if (filter.from) q.set('from', filter.from);
    if (filter.to) q.set('to', filter.to);
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<AuditLog>>(`/audit-logs?${q}`);
  },
};
