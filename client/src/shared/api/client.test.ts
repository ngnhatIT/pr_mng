import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Không có jsdom: tự dựng window/localStorage/sessionStorage tối thiểu cho client.ts.
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Client = typeof import('./client');
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

async function load(path = '/app', seed: Record<string, string> = {}) {
  vi.resetModules();
  const ls = memStorage();
  for (const [k, v] of Object.entries(seed)) ls.setItem(k, v);
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('sessionStorage', memStorage());
  vi.stubGlobal('window', {
    location: { pathname: path, search: '' },
    dispatchEvent: vi.fn(),
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = await import('./client');
}

const staff = { id: 1, username: 'admin', role: 'admin', name: 'A' };
const parent = { id: 9, username: '0900000000', role: 'parent', name: 'P' };

beforeEach(() => load());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('api() 401 -> refresh -> retry', () => {
  it('request có token bị 401: refresh 1 lần rồi gửi lại với token mới', async () => {
    client.setAuth('old', staff);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: 'expired' }))
      .mockResolvedValueOnce(json(200, { token: 'new' }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(client.api('/students')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
    expect(client.getToken()).toBe('new');
  });

  it('CORR-4: login sai mật khẩu (không token) -> hiện lỗi của server, không refresh', async () => {
    localStorage.setItem('edu_user_staff', JSON.stringify(staff)); // user cũ còn sót
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng' }));
    await expect(client.api('/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow(
      'Tên đăng nhập hoặc mật khẩu không đúng'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('edu_user_staff')).not.toBeNull();
  });
});

describe('api() timeout / abort', () => {
  // fetch giả: treo cho tới khi signal abort
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) =>
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    );

  it('CORR-6: GET timeout được retry với signal MỚI', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(hang).mockResolvedValueOnce(json(200, { ok: 2 }));
    const p = client.api('/x');
    await vi.advanceTimersByTimeAsync(30_000 + 500);
    await expect(p).resolves.toEqual({ ok: 2 });
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it('caller tự abort -> ném AbortError, không đổi thành timeout, không retry', async () => {
    fetchMock.mockImplementation(hang);
    const ac = new AbortController();
    const p = client.api('/x', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('user theo cổng (CORR-5) + logout', () => {
  it('phiên phụ huynh không đè phiên staff', async () => {
    client.setAuth('t1', staff);
    client.setAuth('t2', parent);
    expect(client.getUser()).toEqual(staff); // đang ở /app
    await load('/parent', { edu_user_staff: JSON.stringify(staff), edu_user_parent: JSON.stringify(parent) });
    expect(client.getUser()).toEqual(parent);
    fetchMock.mockResolvedValueOnce(json(200, { token: 'p' }));
    await client.tryRefresh();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/parent/refresh');
  });

  it("migrate key cũ 'edu_user' 1 lần", async () => {
    await load('/teacher', { edu_user: JSON.stringify(staff) });
    expect(client.getUser()).toEqual(staff);
    expect(localStorage.getItem('edu_user')).toBeNull();
  });

  it('SEC-4: logout xóa deep-link edu_next', async () => {
    client.setAuth('t', staff);
    sessionStorage.setItem('edu_next', '/app/students');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await client.logout();
    expect(sessionStorage.getItem('edu_next')).toBeNull();
    expect(client.getUser()).toBeNull();
    expect(client.getToken()).toBeNull();
  });
});

describe('superadmin chọn trung tâm (?center_id)', () => {
  const sa = { id: 2, username: 'root', role: 'superadmin', name: 'Root' };

  it('chưa chọn -> không gắn; chọn -> gắn vào mọi request trừ /auth, /centers', async () => {
    client.setAuth('t', sa);
    expect(client.withActingCenter('/classes')).toBe('/classes');
    client.setActingCenter(7);
    expect(client.withActingCenter('/classes')).toBe('/classes?center_id=7');
    expect(client.withActingCenter('/students?page=2')).toBe('/students?page=2&center_id=7');
    expect(client.withActingCenter('/students?center_id=3')).toBe('/students?center_id=3');
    expect(client.withActingCenter('/auth/me')).toBe('/auth/me');
    expect(client.withActingCenter('/centers')).toBe('/centers');
    fetchMock.mockResolvedValueOnce(json(200, []));
    await client.api('/rooms');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/rooms?center_id=7');
  });

  it('user không phải superadmin: không bao giờ gắn', () => {
    client.setAuth('t', staff);
    client.setActingCenter(7);
    expect(client.withActingCenter('/classes')).toBe('/classes');
  });

  it('logout (clearAuth) xóa trung tâm đã chọn', () => {
    client.setAuth('t', sa);
    client.setActingCenter(7);
    client.clearAuth();
    expect(client.getActingCenter()).toBeNull();
  });
});

describe('api() 403 PASSWORD_CHANGE_REQUIRED', () => {
  it('bật cờ must_change_password trên user + phát event cho PasswordChangeGate', async () => {
    client.setAuth('tok', staff);
    fetchMock.mockResolvedValueOnce(json(403, { error: 'x', code: 'PASSWORD_CHANGE_REQUIRED' }));
    await expect(client.api('/students')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(client.getUser()?.must_change_password).toBe(true);
    const ev = (window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls[0][0] as Event;
    expect(ev.type).toBe(client.PASSWORD_CHANGE_EVENT);
  });
});

describe('B4-2: takePostLoginRedirect chỉ nhận deep-link cùng portal', () => {
  it('cùng portal -> trả về và xóa; portal khác / prefix giả -> null', () => {
    sessionStorage.setItem('edu_next', '/teacher/luong?x=1');
    expect(client.takePostLoginRedirect('/teacher')).toBe('/teacher/luong?x=1');
    expect(sessionStorage.getItem('edu_next')).toBeNull();
    sessionStorage.setItem('edu_next', '/teacher');
    expect(client.takePostLoginRedirect('/teacher')).toBe('/teacher');
    for (const bad of ['/parent', '/app/students', '/teachers', '//evil.com/teacher']) {
      sessionStorage.setItem('edu_next', bad);
      expect(client.takePostLoginRedirect('/teacher')).toBeNull();
      expect(sessionStorage.getItem('edu_next')).toBeNull(); // link lạ cũng bị xóa
    }
  });
});

describe('B4-4: 401 hết phiên gắn code SESSION_EXPIRED', () => {
  it('refresh thất bại -> lỗi có code để toastApiError bỏ qua; event chỉ phát 1 lần', async () => {
    client.setAuth('old', staff);
    fetchMock.mockResolvedValue(json(401, { error: 'expired' }));
    await expect(client.api('/students')).rejects.toMatchObject({ code: client.SESSION_EXPIRED });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
