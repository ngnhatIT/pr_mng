/**
 * Test H1: tự động refresh Zalo access token.
 * - Chưa cấu hình refresh_token -> false, không gọi Zalo
 * - Thành công -> access/refresh token + expires_at được lưu vào center_settings
 * - Zalo lỗi -> false (đã log + sendAlert, không throw)
 * - ensureZaloTokenFresh: token còn hạn xa -> không gọi Zalo
 *
 * Cần PostgreSQL (CI). Mock global fetch để không gọi Zalo thật.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://educenter:educenter123@localhost:5432/educenter_test';

import { describe, it, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../db/test-utils';
import { setCenterSetting, getCenterSettings } from '../db/helpers';
import { refreshZaloAccessToken, ensureZaloTokenFresh } from './zalo';

let centerId = 0;
const realFetch = globalThis.fetch;
let fetchCalls: { url: string; init: RequestInit }[] = [];

function mockFetchJson(payload: unknown, ok = true) {
  fetchCalls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return {
      ok,
      status: ok ? 200 : 400,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
}

async function getSetting(center: number, key: string): Promise<string | null> {
  const map = await getCenterSettings(center, [key]);
  return (map.get(key) as string) ?? null;
}

before(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  const c = await db.prepare("INSERT INTO centers (name) VALUES ('TT')").run();
  centerId = Number(c.lastInsertRowid);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(async () => {
  await teardownTestDb();
});

describe('H1: refreshZaloAccessToken', () => {
  it('chưa cấu hình refresh_token -> false, không gọi Zalo', async () => {
    mockFetchJson({});
    assert.equal(await refreshZaloAccessToken(centerId), false);
    assert.equal(fetchCalls.length, 0);
  });

  it('thành công -> lưu token mới + expires_at vào center_settings', async () => {
    await setCenterSetting(centerId, 'zalo_refresh_token', 'old-refresh');
    await setCenterSetting(centerId, 'zalo_app_id', 'app1');
    await setCenterSetting(centerId, 'zalo_app_secret', 's3cr3t');
    mockFetchJson({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7776000 });
    assert.equal(await refreshZaloAccessToken(centerId), true);
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('oauth.zaloapp.com'), 'phải gọi Zalo OAuth');
    // secret đi qua header secret_key, không hard-code trong code
    assert.equal((fetchCalls[0].init.headers as Record<string, string>)['secret_key'], 's3cr3t');
    assert.equal(await getSetting(centerId, 'zalo_access_token'), 'new-access');
    assert.equal(await getSetting(centerId, 'zalo_refresh_token'), 'new-refresh');
    const expiresAt = Number(await getSetting(centerId, 'zalo_token_expires_at'));
    assert.ok(expiresAt > Date.now() + 7000000 * 1000, 'expires_at phải ~90 ngày sau');
  });

  it('Zalo trả lỗi -> false, không throw (đã log + sendAlert)', async () => {
    await setCenterSetting(centerId, 'zalo_refresh_token', 'bad-refresh');
    await setCenterSetting(centerId, 'zalo_app_id', 'app1');
    await setCenterSetting(centerId, 'zalo_app_secret', 's3cr3t');
    mockFetchJson({ error_description: 'Invalid refresh token' }, false);
    assert.equal(await refreshZaloAccessToken(centerId), false);
    // token cũ giữ nguyên, không bị ghi đè rỗng
    assert.equal(await getSetting(centerId, 'zalo_access_token'), null);
  });
});

describe('H1: ensureZaloTokenFresh', () => {
  it('token còn hạn xa -> không gọi Zalo', async () => {
    await setCenterSetting(centerId, 'zalo_refresh_token', 'rt');
    await setCenterSetting(centerId, 'zalo_token_expires_at', String(Date.now() + 30 * 86400 * 1000));
    mockFetchJson({ access_token: 'x' });
    await ensureZaloTokenFresh(centerId);
    assert.equal(fetchCalls.length, 0);
  });

  it('token sắp hết hạn (<24h) -> tự refresh', async () => {
    await setCenterSetting(centerId, 'zalo_refresh_token', 'rt');
    await setCenterSetting(centerId, 'zalo_app_id', 'app1');
    await setCenterSetting(centerId, 'zalo_app_secret', 's3cr3t');
    await setCenterSetting(centerId, 'zalo_token_expires_at', String(Date.now() + 3600 * 1000));
    mockFetchJson({ access_token: 'fresh-access', expires_in: 7776000 });
    await ensureZaloTokenFresh(centerId);
    assert.equal(fetchCalls.length, 1);
    assert.equal(await getSetting(centerId, 'zalo_access_token'), 'fresh-access');
  });
});
