import i18n from '../../i18n';

const API_BASE = '/api/v1';

/** Timeout: 30s cho request thường, 60s cho upload (FormData). */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;

const NEXT_KEY = 'edu_next';

/** Mã lỗi gắn vào Error khi 401 hết phiên (UI riêng: UnauthorizedListener). */
export const SESSION_EXPIRED = 'SESSION_EXPIRED';

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

export type StoredUser = {
  id: number;
  username: string;
  role: string;
  name: string;
  /** Tên trung tâm (server trả ở login/refresh/me); null với superadmin. */
  center_name?: string | null;
  /** Server bắt đổi mật khẩu (mật khẩu tạm do admin đặt lại): app mở form đổi mật khẩu bắt buộc. */
  must_change_password?: boolean;
};
type Portal = 'staff' | 'parent';

/**
 * CORR-5: user lưu RIÊNG theo cổng (staff / parent) — refresh cookie của 2 cổng đã tách path,
 * nên 2 tab (giáo viên ở /teacher, phụ huynh ở /parent) không được đè nhau. Cổng chọn theo path.
 */
const USER_KEYS: Record<Portal, string> = { staff: 'edu_user_staff', parent: 'edu_user_parent' };

function currentPortal(): Portal {
  return window.location.pathname.startsWith('/parent') ? 'parent' : 'staff';
}

// Migrate 1 lần key cũ 'edu_user' (dùng chung 2 cổng) sang key theo cổng.
try {
  const legacy = localStorage.getItem('edu_user');
  if (legacy) {
    const portal: Portal = (JSON.parse(legacy) as StoredUser).role === 'parent' ? 'parent' : 'staff';
    if (!localStorage.getItem(USER_KEYS[portal])) localStorage.setItem(USER_KEYS[portal], legacy);
    localStorage.removeItem('edu_user');
  }
} catch {
  /* bỏ qua */
}

export function getUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEYS[currentPortal()]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Lưu phiên đăng nhập (dùng chung cho mọi màn hình login). D4: chỉ lưu access
 * token trong memory; refresh token nằm trong HttpOnly cookie do server set. */
export function setAuth(token: string, user: unknown): void {
  accessToken = token;
  const portal: Portal = (user as StoredUser | null)?.role === 'parent' ? 'parent' : 'staff';
  localStorage.setItem(USER_KEYS[portal], JSON.stringify(user));
  sessionExpiredNotified = false;
}

/** Gộp thay đổi vào user đã lưu của cổng hiện tại (vd: tắt must_change_password sau khi đổi). */
export function updateUser(patch: Partial<StoredUser>): void {
  const user = getUser();
  if (user) localStorage.setItem(USER_KEYS[currentPortal()], JSON.stringify({ ...user, ...patch }));
}

/** api() phát event này khi server trả 403 PASSWORD_CHANGE_REQUIRED (PasswordChangeGate lắng nghe). */
export const PASSWORD_CHANGE_EVENT = 'edu:password-change-required';

/** Xóa phiên đăng nhập của cổng hiện tại + deep-link đã lưu + CacheStorage của SW (SEC-1/SEC-4). */
/**
 * Superadmin chọn 1 trung tâm để thao tác (ô "Trung tâm" trên thanh tiêu đề). api() tự gắn
 * `?center_id=` — server coi superadmin như thành viên trung tâm đó (đọc lẫn ghi).
 * null = toàn hệ thống (chỉ xem; thao tác ghi dữ liệu trung tâm sẽ bị 400 CENTER_REQUIRED).
 */
const ACTING_CENTER_KEY = 'edu_sa_center';

export function getActingCenter(): number | null {
  try {
    const n = Number(localStorage.getItem(ACTING_CENTER_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setActingCenter(id: number | null): void {
  try {
    if (id) localStorage.setItem(ACTING_CENTER_KEY, String(id));
    else localStorage.removeItem(ACTING_CENTER_KEY);
  } catch {
    /* bỏ qua */
  }
}

/** Gắn ?center_id cho superadmin đang chọn trung tâm (không đụng /auth, /centers, path đã có). */
export function withActingCenter(path: string): string {
  if (currentPortal() !== 'staff' || getUser()?.role !== 'superadmin') return path;
  const cid = getActingCenter();
  if (!cid || /[?&]center_id=/.test(path) || /^\/(auth|centers)(\/|\?|$)/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}center_id=${cid}`;
}

export function clearAuth(): void {
  accessToken = null;
  try {
    localStorage.removeItem(USER_KEYS[currentPortal()]);
    if (currentPortal() === 'staff') localStorage.removeItem(ACTING_CENTER_KEY);
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    /* bỏ qua */
  }
  if (typeof caches !== 'undefined') {
    void caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => undefined);
  }
}

export function authPath(action: 'refresh' | 'logout' | 'change-password' | 'logout-all'): string {
  return currentPortal() === 'parent' ? `/parent/${action}` : `/auth/${action}`;
}

/** Đăng xuất: thu hồi refresh token trên server qua cookie (best-effort) rồi xóa local. */
export async function logout(): Promise<void> {
  if (getUser()) {
    try {
      // D4: không gửi body nữa — server đọc refresh token từ HttpOnly cookie
      await fetch(API_BASE + authPath('logout'), { method: 'POST', credentials: 'include' });
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
export function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const user = getUser();
      if (!user) return false;
      const res = await fetch(API_BASE + authPath('refresh'), {
        method: 'POST',
        credentials: 'include', // D4: gửi HttpOnly cookie refresh_token
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string; user?: Partial<StoredUser> };
      if (!data.token) return false;
      // Gộp user mới từ server (vd: center_name) — phiên cũ không phải đăng nhập lại mới có.
      setAuth(data.token, data.user ? { ...user, ...data.user } : user);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Lấy deep-link đã lưu trước khi bị đá về login (đã validate), rồi xóa.
 * B4-2: chỉ nhận deep-link thuộc portal `home` của role vừa đăng nhập ('/app' | '/teacher' | '/parent');
 * link của portal khác (máy dùng chung: phụ huynh hết phiên rồi giáo viên đăng nhập) bị bỏ qua.
 */
export function takePostLoginRedirect(home: string): string | null {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    if (next && (next === home || ['/', '?', '#'].some((c) => next.startsWith(home + c)))) return next;
  } catch {
    /* bỏ qua */
  }
  return null;
}

function tApi(key: string): string {
  return i18n.t(key, { ns: 'common' });
}

const REFRESH_RETRIED = Symbol('refreshRetried');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isRefreshRetry = (options as Record<symbol, boolean>)[REFRESH_RETRIED] === true;
  const callerSignal = options.signal;

  let res: Response;
  // Retry 1 lần cho lỗi transient (502/503/504 hoặc timeout) với GET — mạng VN chập chờn
  const isIdempotent = !options.method || options.method.toUpperCase() === 'GET';
  for (let attempt = 0; ; attempt++) {
    // CORR-6: mỗi lần thử có AbortController + timer RIÊNG (lần retry không dùng lại signal đã abort).
    // Signal của caller vẫn được tôn trọng: caller abort -> abort request, ném nguyên AbortError.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS
    );
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    try {
      res = await fetch(API_BASE + withActingCenter(path), {
        ...options,
        signal: controller.signal,
        credentials: 'include', // D4: gửi HttpOnly cookie refresh_token (same-origin; CORS credentials vẫn false)
        headers: {
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      if (timedOut) {
        if (isIdempotent && attempt < 1) {
          await sleep(500);
          continue;
        }
        throw new Error(tApi('api.timeout'), { cause: err });
      }
      if (callerSignal?.aborted) throw err; // caller tự hủy: không đổi thành 'timeout'
      throw new Error(tApi('api.network'), { cause: err });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
    const transient = res.status === 502 || res.status === 503 || res.status === 504;
    if (isIdempotent && transient && attempt < 1) {
      await sleep(500);
      continue;
    }
    break;
  }

  // CORR-4: chỉ coi 401 là "hết phiên" khi request CÓ gửi token. Request không token (login, quên mật khẩu...)
  // trả 401 = sai thông tin -> rơi xuống nhánh lỗi chung để hiện đúng message của server.
  if (res.status === 401 && token) {
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
    // B4-4: gắn code để toastApiError bỏ qua (UnauthorizedListener đã toast + điều hướng)
    throw Object.assign(new Error(tApi('api.sessionExpired')), { code: SESSION_EXPIRED });
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
    if (res.status === 403 && body.code === 'PASSWORD_CHANGE_REQUIRED') {
      updateUser({ must_change_password: true });
      window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
    }
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
