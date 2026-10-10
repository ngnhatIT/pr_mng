/**
 * Test refresh token rotation:
 * - login cấp cặp token (access 15m + refresh opaque)
 * - refresh thành công -> cặp mới, token cũ bị revoke
 * - dùng lại token cũ -> 401 + toàn bộ chuỗi bị thu hồi (theft detection)
 * - logout -> refresh token bị revoke
 * - refresh token hết hạn -> 401
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { db } from '../../db/pg-compat';
import { setupTestDb, resetTestDb, teardownTestDb } from '../../db/test-utils';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllForOwner } from './refresh.service';
import { AuthUser } from '../../middleware/auth';

const staffUser: AuthUser = {
  id: 1,
  username: 'admin',
  role: 'admin',
  kind: 'staff',
  name: 'Admin',
  center_id: 1,
};

describe('refresh token rotation (PostgreSQL)', () => {
  before(async () => {
    await setupTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    await db.prepare("INSERT INTO centers (id, name) VALUES (1, 'TT')").run();
    await db
      .prepare(
        "INSERT INTO users (id, username, password_hash, role, name, center_id) VALUES (1,'admin','x','admin','Admin',1)"
      )
      .run();
  });
  after(async () => {
    await teardownTestDb();
  });

  it('issueTokenPair cấp access token + refresh token opaque', async () => {
    const pair = await issueTokenPair(staffUser, { ip: '127.0.0.1' });
    assert.ok(pair.token.length > 20);
    assert.ok(pair.refresh_token.length >= 40);
    assert.equal(pair.expires_in, 900); // ACCESS_TOKEN_TTL mặc định 15 phút (D2)
    // DB chỉ lưu hash, không lưu token thô
    const rows = (await db.prepare('SELECT token_hash FROM refresh_tokens').all()) as {
      token_hash: string;
    }[];
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].token_hash.includes(pair.refresh_token.slice(0, 8)));
    assert.equal(rows[0].token_hash.length, 64); // SHA-256 hex
  });

  it('rotate thành công -> cặp mới, token cũ bị revoke', async () => {
    const p1 = await issueTokenPair(staffUser);
    const p2 = await rotateRefreshToken(p1.refresh_token);
    assert.notEqual(p2.refresh_token, p1.refresh_token);
    assert.notEqual(p2.token, p1.token);
    const old = (await db
      .prepare('SELECT revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = ?')
      .get(createHash('sha256').update(p1.refresh_token).digest('hex'))) as {
      revoked_at: string | null;
      replaced_by: string | null;
    };
    assert.ok(old.revoked_at, 'token cũ phải bị revoke');
    assert.ok(old.replaced_by, 'phải ghi replaced_by');
  });

  it('B4: 2 request refresh đồng thời với cùng token -> cả 2 đều nhận cặp hợp lệ (grace 30s)', async () => {
    const p1 = await issueTokenPair(staffUser);
    const [r1, r2] = await Promise.all([
      rotateRefreshToken(p1.refresh_token),
      rotateRefreshToken(p1.refresh_token),
    ]);
    assert.ok(r1.refresh_token.length >= 40 && r2.refresh_token.length >= 40);
    assert.notEqual(r1.refresh_token, r2.refresh_token);
    // Chuỗi KHÔNG bị thu hồi: refresh token mới của cả 2 vẫn dùng được
    const r3 = await rotateRefreshToken(r1.refresh_token);
    const r4 = await rotateRefreshToken(r2.refresh_token);
    assert.ok(r3.refresh_token.length >= 40 && r4.refresh_token.length >= 40);
  });

  it('B4: dùng lại token cũ quá 30s sau rotation -> coi là trộm, thu hồi chuỗi', async () => {
    const p1 = await issueTokenPair(staffUser);
    const p2 = await rotateRefreshToken(p1.refresh_token);
    // Giả lập hết grace window: lùi revoked_at về 61s trước
    await db
      .prepare(`UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '61 seconds' WHERE token_hash = ?`)
      .run(createHash('sha256').update(p1.refresh_token).digest('hex'));
    await assert.rejects(() => rotateRefreshToken(p1.refresh_token), /đánh cắp/);
    // Chuỗi bị thu hồi: cả token mới cũng không dùng được
    await assert.rejects(() => rotateRefreshToken(p2.refresh_token));
  });

  it('B4: logout rồi dùng lại token trong 30s -> không được cấp mới (không grace)', async () => {
    const p1 = await issueTokenPair(staffUser);
    await revokeRefreshToken(p1.refresh_token); // revoke không qua rotation: replaced_by NULL
    await assert.rejects(() => rotateRefreshToken(p1.refresh_token), /không hợp lệ|hết hạn|thu hồi/);
  });

  it('dùng lại token đã revoke ngoài grace window -> thu hồi toàn bộ chuỗi (chống trộm)', async () => {
    const p1 = await issueTokenPair(staffUser);
    const p2 = await rotateRefreshToken(p1.refresh_token);
    // Hết grace 30s rồi kẻ trộm mới dùng lại token cũ p1
    await db
      .prepare(`UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '61 seconds' WHERE token_hash = ?`)
      .run(createHash('sha256').update(p1.refresh_token).digest('hex'));
    await assert.rejects(() => rotateRefreshToken(p1.refresh_token), /thu hồi|không hợp lệ|đánh cắp/);
    // Cả token mới p2 cũng bị thu hồi theo
    await assert.rejects(() => rotateRefreshToken(p2.refresh_token), /thu hồi|không hợp lệ/);
  });

  it('logout revoke refresh token', async () => {
    const p1 = await issueTokenPair(staffUser);
    await revokeRefreshToken(p1.refresh_token);
    await assert.rejects(() => rotateRefreshToken(p1.refresh_token), /không hợp lệ|hết hạn|thu hồi/);
  });

  it('revokeAllForOwner thu hồi hết token của user', async () => {
    const p1 = await issueTokenPair(staffUser);
    const p2 = await issueTokenPair(staffUser);
    await revokeAllForOwner('staff', 1);
    await assert.rejects(() => rotateRefreshToken(p1.refresh_token));
    await assert.rejects(() => rotateRefreshToken(p2.refresh_token));
  });

  it('refresh token của parent dựng lại đúng AuthUser', async () => {
    await db
      .prepare(
        "INSERT INTO parents (id, center_id, phone, password_hash, name) VALUES (7, 1, '0900000001', 'x', 'PH')"
      )
      .run();
    const parentUser: AuthUser = {
      id: 7,
      username: '0900000001',
      role: 'parent',
      kind: 'parent',
      name: 'PH',
      center_id: 1,
      parent_id: 7,
    };
    const p1 = await issueTokenPair(parentUser);
    const p2 = await rotateRefreshToken(p1.refresh_token);
    assert.ok(p2.token.length > 20);
    // Giải mã payload access token mới để check kind/parent_id
    const payload = JSON.parse(Buffer.from(p2.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.kind, 'parent');
    assert.equal(payload.parent_id, 7);
  });
});
