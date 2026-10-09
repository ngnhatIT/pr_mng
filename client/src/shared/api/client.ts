const API_BASE = '/api/v1';

export function getToken(): string | null {
  return localStorage.getItem('edu_token');
}

export function getUser(): { id: number; username: string; role: string; name: string } | null {
  try {
    const raw = localStorage.getItem('edu_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Lưu phiên đăng nhập (dùng chung cho mọi màn hình login). */
export function setAuth(token: string, user: unknown): void {
  localStorage.setItem('edu_token', token);
  localStorage.setItem('edu_user', JSON.stringify(user));
}

/** Xóa phiên đăng nhập. */
export function clearAuth(): void {
  localStorage.removeItem('edu_token');
  localStorage.removeItem('edu_user');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('edu_token');
    localStorage.removeItem('edu_user');
    const path = window.location.pathname;
    const loginPath = path.startsWith('/parent') ? '/parent/login' : '/login';
    if (path !== loginPath) window.location.href = loginPath;
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Đã xảy ra lỗi');
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', body: form }),
};

/** Envelope pagination chuẩn từ server: { data, pagination } */
export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Params phân trang cho query string. */
export interface PageParams {
  page?: number;
  limit?: number;
}
