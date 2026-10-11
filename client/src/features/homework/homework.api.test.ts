import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tryRefresh = vi.fn(async () => true);
let token = 'old';
vi.mock('../../shared/api/client', () => ({
  http: {},
  getToken: () => token,
  withActingCenter: (p: string) => p,
  tryRefresh: () => {
    token = 'new';
    return tryRefresh();
  },
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import { uploadFile } from './homework.api';

/** XHR giả: token 'old' → 401, token mới → 201. */
const sentTokens: string[] = [];
class FakeXHR {
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  upload = { onprogress: null as unknown };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private auth = '';
  open() {}
  setRequestHeader(_k: string, v: string) {
    this.auth = v;
  }
  send() {
    sentTokens.push(this.auth);
    queueMicrotask(() => {
      if (this.auth === 'Bearer old') {
        this.status = 401;
        this.responseText = '{"error":"expired"}';
      } else {
        this.status = 201;
        this.responseText = '{"url":"/uploads/hw_x.pdf","name":"a.pdf","size":1}';
      }
      this.onload?.();
    });
  }
}

describe('uploadFile', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    sentTokens.length = 0;
    token = 'old';
    tryRefresh.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('401 → refresh token rồi gửi lại 1 lần', async () => {
    const res = await uploadFile(new File(['x'], 'a.pdf'), () => {});
    expect(res.url).toBe('/uploads/hw_x.pdf');
    expect(tryRefresh).toHaveBeenCalledTimes(1);
    expect(sentTokens).toEqual(['Bearer old', 'Bearer new']);
  });

  it('refresh thất bại → reject, không gửi lại', async () => {
    tryRefresh.mockResolvedValueOnce(false);
    token = 'old';
    // refresh mock đổi token nhưng trả false → không retry
    await expect(uploadFile(new File(['x'], 'a.pdf'), () => {})).rejects.toMatchObject({ status: 401 });
    expect(sentTokens).toEqual(['Bearer old']);
  });
});
