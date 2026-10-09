/**
 * API layer cho Phân quyền (roles & permissions).
 * Yêu cầu quyền roles.view để xem, roles.manage để thay đổi.
 */
import { http } from '../../shared/api/client';

export type Scope = 'own' | 'center' | 'all';

export interface Permission {
  id: number;
  code: string;
  name: string;
  description: string | null;
  module: string;
}

export interface Role {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  center_id: number | null;
  perm_count: number;
  user_count: number;
}

export interface RoleDetail extends Role {
  permissions: { code: string; name: string; module: string; scope: Scope }[];
}

export interface MyPermission {
  code: string;
  scope: Scope;
}

export const SCOPE_LABEL: Record<Scope, string> = {
  own: 'Của mình',
  center: 'Trung tâm',
  all: 'Tất cả',
};

export const MODULE_LABEL: Record<string, string> = {
  students: 'Học viên',
  classes: 'Lớp học',
  attendance: 'Điểm danh',
  sessions: 'Buổi học',
  invoices: 'Học phí',
  teachers: 'Giáo viên',
  payroll: 'Lương',
  homework: 'Bài tập',
  grades: 'Điểm số',
  reports: 'Báo cáo',
  leaves: 'Nghỉ phép',
  rooms: 'Phòng học',
  trials: 'Học thử',
  leads: 'Leads',
  referrals: 'Giới thiệu',
  reviews: 'Đánh giá',
  notifications: 'Thông báo',
  settings: 'Cấu hình',
  users: 'Tài khoản',
  roles: 'Phân quyền',
  system: 'Hệ thống',
};

export function moduleLabel(module: string): string {
  return MODULE_LABEL[module] || module;
}

export const rolesApi = {
  permissions: () => http.get<{ data: Permission[] }>('/roles/permissions'),
  list: () => http.get<{ data: Role[] }>('/roles'),
  detail: (id: number) => http.get<RoleDetail>(`/roles/${id}`),
  create: (input: { code: string; name: string; description?: string }) =>
    http.post<{ id: number; code: string }>('/roles', input),
  update: (id: number, input: { name?: string; description?: string }) =>
    http.put<{ ok: boolean }>(`/roles/${id}`, input),
  remove: (id: number) => http.del<{ ok: boolean }>(`/roles/${id}`),
  setPermissions: (id: number, permissions: { code: string; scope: Scope }[]) =>
    http.put<{ ok: boolean; count: number }>(`/roles/${id}/permissions`, { permissions }),
  assign: (user_id: number, role_id: number) => http.post<{ ok: boolean }>('/roles/assign', { user_id, role_id }),
  unassign: (user_id: number, role_id: number) =>
    http.del<{ ok: boolean }>(`/roles/assign?user_id=${user_id}&role_id=${role_id}`),
  mine: () => http.get<{ data: MyPermission[] }>('/roles/me/permissions'),
};
