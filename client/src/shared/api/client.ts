import i18n from '../../i18n';

const API_BASE = '/api/v1';

/** Timeout: 30s cho request thường, 60s cho upload (FormData). */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;

const NEXT_KEY = 'edu_next';

/** Cờ chống toast 401 dồn dập: chỉ báo 1 lần cho tới khi đăng nhập lại. */
let sessionExpiredNotified = false;

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
export function setAuth(token: string, user: unknown, refreshToken?: string): void {
  localStorage.setItem('edu_token', token);
  localStorage.setItem('edu_user', JSON.stringify(user));
  if (refreshToken) localStorage.setItem('edu_refresh_token', refreshToken);
  sessionExpiredNotified = false;
}

/** Xóa phiên đăng nhập. */
export function clearAuth(): void {
  localStorage.removeItem('edu_token');
  localStorage.removeItem('edu_user');
  localStorage.removeItem('edu_refresh_token');
}

/** Đăng xuất: thu hồi refresh token trên server (best-effort) rồi xóa local. */
export async function logout(): Promise<void> {
  const rt = localStorage.getItem('edu_refresh_token');
  const user = getUser();
  if (rt && user) {
    const path = user.role === 'parent' ? '/parent/logout' : '/auth/logout';
    try {
      await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      /* best-effort */
    }
  }
  clearAuth();
}

/** Đổi refresh token lấy cặp token mới. Dùng chung promise để chống refresh dồn dập. */
let refreshPromise: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const rt = localStorage.getItem('edu_refresh_token');
      const user = getUser();
      if (!rt || !user) return false;
      const path = user.role === 'parent' ? '/parent/refresh' : '/auth/refresh';
      const res = await fetch(API_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string; refresh_token: string };
      if (!data.token || !data.refresh_token) return false;
      setAuth(data.token, user, data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Lấy deep-link đã lưu trước khi bị đá về login (đã validate), rồi xóa. */
export function takePostLoginRedirect(): string | null {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  } catch {
    /* bỏ qua */
  }
  return null;
}

function tApi(key: string): string {
  return i18n.t(key, { ns: 'common' });
}

const REFRESH_RETRIED = Symbol('refreshRetried');

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isRefreshRetry = (options as Record<symbol, boolean>)[REFRESH_RETRIED] === true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...options,
      // Ưu tiên signal của caller (nếu có), mặc định dùng signal timeout nội bộ.
      signal: options.signal ?? controller.signal,
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(tApi('api.timeout'), { cause: err });
    }
    throw new Error(tApi('api.network'), { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    // Thử refresh token 1 lần trước khi đá về login (access token chỉ sống 1 giờ).
    if (!isRefreshRetry && (await tryRefresh())) {
      return api<T>(path, { ...options, [REFRESH_RETRIED]: true } as RequestInit);
    }
    clearAuth();
    const cur = window.location.pathname;
    const loginPath = cur.startsWith('/parent') ? '/parent/login' : '/login';
    if (cur !== loginPath && !sessionExpiredNotified) {
      sessionExpiredNotified = true;
      try {
        sessionStorage.setItem(NEXT_KEY, cur + window.location.search);
      } catch {
        /* bỏ qua */
      }
      // Không reload toàn trang: báo cho app navigate mềm qua event.
      window.dispatchEvent(new CustomEvent('edu:unauthorized', { detail: { loginPath } }));
    }
    throw new Error(tApi('api.sessionExpired'));
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || tApi('api.error'));
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
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
