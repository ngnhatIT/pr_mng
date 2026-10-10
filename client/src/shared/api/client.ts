import i18n from '../../i18n';

const API_BASE = '/api/v1';

/** Timeout: 30s cho request thường, 60s cho upload (FormData). */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;

const NEXT_KEY = 'edu_next';

/**
 * D4: access token giữ TRONG MEMORY (biến module), không lưu localStorage nữa
 * để XSS không đọc được. Reload trang -> token mất -> interceptor 401 tự gọi
 * /refresh (refresh token nằm trong HttpOnly cookie, browser tự gửi kèm).
 */
let accessToken: string | null = null;

/** Cờ chống toast 401 dồn dập: chỉ báo 1 lần cho tới khi đăng nhập lại. */
let sessionExpiredNotified = false;

export function getToken(): string | null {
  return accessToken;
}

export function getUser(): { id: number; username: string; role: string; name: string } | null {
  try {
    const raw = localStorage.getItem('edu_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Lưu phiên đăng nhập (dùng chung cho mọi màn hình login). D4: chỉ lưu access
 * token trong memory; refresh token nằm trong HttpOnly cookie do server set. */
export function setAuth(token: string, user: unknown): void {
  accessToken = token;
  localStorage.setItem('edu_user', JSON.stringify(user));
  sessionExpiredNotified = false;
}

/** Xóa phiên đăng nhập. */
export function clearAuth(): void {
  accessToken = null;
  localStorage.removeItem('edu_user');
}

/** Đăng xuất: thu hồi refresh token trên server qua cookie (best-effort) rồi xóa local. */
export async function logout(): Promise<void> {
  const user = getUser();
  if (user) {
    const path = user.role === 'parent' ? '/parent/logout' : '/auth/logout';
    try {
      // D4: không gửi body nữa — server đọc refresh token từ HttpOnly cookie
      await fetch(API_BASE + path, { method: 'POST', credentials: 'include' });
    } catch {
      /* best-effort */
    }
  }
  clearAuth();
}

/**
 * Đổi refresh token (HttpOnly cookie, browser tự gửi kèm) lấy access token mới.
 * Dùng chung promise để chống refresh dồn dập.
 */
let refreshPromise: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const user = getUser();
      if (!user) return false;
      const path = user.role === 'parent' ? '/parent/refresh' : '/auth/refresh';
      const res = await fetch(API_BASE + path, {
        method: 'POST',
        credentials: 'include', // D4: gửi HttpOnly cookie refresh_token
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string };
      if (!data.token) return false;
      setAuth(data.token, user);
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
  // Retry 1 lần cho lỗi transient (502/503/504 hoặc timeout) với GET — mạng VN chập chờn
  const isIdempotent = !options.method || options.method.toUpperCase() === 'GET';
  let attempt = 0;
  for (;;) {
    try {
      res = await fetch(API_BASE + path, {
        ...options,
        signal: options.signal ?? controller.signal,
        credentials: 'include', // D4: gửi HttpOnly cookie refresh_token (same-origin; CORS credentials vẫn false)
        headers: {
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      // Timeout (AbortError) với GET: retry 1 lần (mạng VN chập chờn)
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (isIdempotent && attempt < 1) {
          attempt++;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        throw new Error(tApi('api.timeout'), { cause: err });
      }
      throw new Error(tApi('api.network'), { cause: err });
    }
    attempt++;
    const transient = res.status === 502 || res.status === 503 || res.status === 504;
    if (isIdempotent && transient && attempt < 2) {
      // Chờ 500ms rồi thử lại 1 lần
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    break;
  }
  clearTimeout(timer);

  if (res.status === 401) {
    // Thử refresh token 1 lần trước khi đá về login (access token chỉ sống 15 phút).
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
    const body = data as { error?: string; code?: string; request_id?: string };
    // Gắn code + request_id vào error để UI xử lý theo code (không match message theo ngôn ngữ)
    const err = new Error(body.error || tApi('api.error')) as Error & { code?: string; requestId?: string };
    if (body.code) err.code = body.code;
    if (body.request_id) err.requestId = body.request_id;
    throw err;
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  /**
   * POST với Idempotency-Key do caller cung cấp (ổn định cho mỗi intent).
   * Caller sinh key 1 lần khi user thực hiện action (vd: crypto.randomUUID() trong
   * handler submit), truyền vào đây. Double-click / retry cùng intent dùng cùng
   * key → server dedupe. Không dùng cho GET/PUT/DELETE.
   */
  postIdempotent: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    api<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { 'Idempotency-Key': idempotencyKey ?? crypto.randomUUID() },
    }),
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
