/**
 * API layer cho Phân quyền (roles & permissions).
 * Yêu cầu quyền roles.view để xem, roles.manage để thay đổi.
 */
import { useEffect, useState } from 'react';
import { getToken, http } from '../../shared/api/client';

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

/**
 * Key i18n cho nhãn phạm vi, dùng với t(scopeLabelKey(scope), { ns: 'roles' }).
 * Thay thế SCOPE_LABEL cứng tiếng Việt trước đây.
 */
export function scopeLabelKey(scope: Scope): string {
  return `scope.${scope}`;
}

/**
 * Key i18n cho tên module, dùng với t(moduleLabelKey(module), { ns: 'roles', defaultValue: module }).
 * Thay thế MODULE_LABEL cứng tiếng Việt trước đây.
 */
export function moduleLabelKey(module: string): string {
  return `module.${module}`;
}

export const rolesApi = {
  permissions: () => http.get<{ catalog: number; rows: Permission[] }>('/roles/permissions'),
  list: () => http.get<Role[]>('/roles'),
  detail: (id: number) => http.get<RoleDetail>(`/roles/${id}`),
  create: (input: { code: string; name: string; description?: string }) =>
    http.post<{ id: number; code: string }>('/roles', input),
  update: (id: number, input: { name?: string; description?: string }) =>
    http.put<{ ok: boolean }>(`/roles/${id}`, input),
  remove: (id: number) => http.del<{ ok: boolean }>(`/roles/${id}`),
  setPermissions: (id: number, permissions: { code: string; scope: Scope }[]) =>
    http.put<{ ok: boolean; count: number }>(`/roles/${id}/permissions`, { permissions }),
  assign: (user_id: number, role_id: number) =>
    http.post<{ ok: boolean }>('/roles/assign', { user_id, role_id }),
  unassign: (user_id: number, role_id: number) =>
    http.del<{ ok: boolean }>(`/roles/assign?user_id=${user_id}&role_id=${role_id}`),
  mine: () => http.get<MyPermission[]>('/roles/me/permissions'),
};

// UX-9: cache quyền theo access token -> Layout + mọi trang dùng chung 1 request (trước: mỗi lần mở trang 1 request,
// nút "Thêm/Sửa" hiện trễ). Token đổi (đăng nhập lại / refresh 15 phút) thì tải lại; lỗi thì bỏ cache để lần sau thử lại.
type MineCache = { token: string | null; promise: Promise<Set<string>>; value?: Set<string> };
let mineCache: MineCache | null = null;

export function loadMyPermissions(): Promise<Set<string>> {
  const token = getToken();
  if (!mineCache || mineCache.token !== token) {
    const entry: MineCache = { token, promise: rolesApi.mine().then((r) => new Set(r.map((p) => p.code))) };
    entry.promise.then(
      (v) => (entry.value = v),
      () => {
        if (mineCache === entry) mineCache = null;
      }
    );
    mineCache = entry;
  }
  return mineCache.promise;
}

/**
 * ADM-21: quyền của user hiện tại để ẩn nút sẽ bị 403. Fail-closed: đang tải/lỗi -> Set rỗng (ẩn nút);
 * server vẫn là nơi chặn thật, đây chỉ là UX. Đã có cache thì trả ngay từ lần render đầu (không nháy nút).
 */
export function useMyPermissions(): Set<string> {
  const [perms, setPerms] = useState<Set<string>>(
    () => (mineCache?.token === getToken() && mineCache.value) || new Set()
  );
  useEffect(() => {
    let alive = true;
    loadMyPermissions()
      .then((s) => alive && setPerms(s))
      .catch(() => alive && setPerms(new Set()));
    return () => {
      alive = false;
    };
  }, []);
  return perms;
}
