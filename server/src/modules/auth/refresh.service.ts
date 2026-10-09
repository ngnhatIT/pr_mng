import crypto from 'crypto';
import { db } from '../../db';
import { signToken, AuthUser } from '../../middleware/auth';
import { AppError } from '../../shared/errors';
import { env } from '../../config/env';

/**
 * Refresh token rotation — nâng cấp bảo mật phiên đăng nhập.
 *
 * Vấn đề cũ: access token (JWT) sống 7 ngày, không thu hồi được. Token lộ =
 * attacker dùng thoải mái cả tuần.
 *
 * Cơ chế mới:
 * - Access token: JWT, sống 1 giờ.
 * - Refresh token: chuỗi opaque 48 byte (lưu DB dưới dạng SHA-256 hash),
 *   sống 30 ngày, mỗi lần dùng sẽ ROTATE: revoke token cũ, cấp cặp mới.
 * - Dùng lại token đã revoke -> coi như bị trộm -> thu hồi TOÀN BỘ chuỗi
 *   refresh token của user đó (theft detection).
 * - Logout -> revoke refresh token hiện tại.
 */

const ACCESS_TOKEN_TTL = env.ACCESS_TOKEN_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`;
const REFRESH_TOKEN_DAYS = env.REFRESH_TOKEN_DAYS;

export interface TokenPair {
  token: string;
  refresh_token: string;
  expires_in: number; // giây
}

interface RefreshRow {
  token_hash: string;
  user_id: number | null;
  parent_id: number | null;
  kind: 'staff' | 'parent';
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function newRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/** Đổi chuỗi TTL jwt ('1h', '30m', '7d') ra số giây (để trả về expires_in). */
function ttlToSeconds(ttl: string): number {
  const m = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return 3600;
  const mult = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return Number(m[1]) * mult[m[2] as keyof typeof mult];
}

/** Cấp cặp token mới cho user (dùng ở login/register). */
export async function issueTokenPair(
  user: AuthUser,
  meta?: { ip?: string; userAgent?: string }
): Promise<TokenPair> {
  const token = signToken(user, ACCESS_TOKEN_TTL);
  const refreshToken = newRefreshToken();
  const isParent = user.kind === 'parent' || user.role === 'parent';
  const kind = isParent ? 'parent' : 'staff';
  const ownerId = isParent ? (user.parent_id ?? user.id) : user.id;
  // Giới hạn 10 session đồng thời: revoke session cũ nhất khi vượt
  const oldSessions = (await db
    .prepare(
      `SELECT id FROM refresh_tokens
       WHERE kind = ? AND ${isParent ? 'parent_id' : 'user_id'} = ?
         AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC OFFSET 9`
    )
    .all(kind, ownerId)) as { id: number }[];
  for (const s of oldSessions) {
    await db.prepare('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?').run(s.id);
  }
  await db
    .prepare(
      `INSERT INTO refresh_tokens (token_hash, user_id, parent_id, kind, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, NOW() + (? || ' days')::interval, ?, ?)`
    )
    .run(
      hashToken(refreshToken),
      isParent ? null : user.id,
      isParent ? (user.parent_id ?? user.id) : null,
      isParent ? 'parent' : 'staff',
      String(REFRESH_TOKEN_DAYS),
      meta?.ip ?? null,
      meta?.userAgent ?? null
    );
  return { token, refresh_token: refreshToken, expires_in: ttlToSeconds(ACCESS_TOKEN_TTL) };
}

/** Dựng lại AuthUser từ refresh token row (để ký access token mới). */
async function buildAuthUser(row: RefreshRow): Promise<AuthUser> {
  if (row.kind === 'parent') {
    const p = (await db
      .prepare('SELECT id, phone, name, center_id FROM parents WHERE id = ?')
      .get(row.parent_id)) as
      { id: number; phone: string; name: string; center_id: number | null } | undefined;
    if (!p) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
    return {
      id: p.id,
      username: p.phone,
      role: 'parent',
      kind: 'parent',
      name: p.name,
      center_id: p.center_id,
      parent_id: p.id,
    };
  }
  const u = (await db
    .prepare('SELECT id, username, role, name, center_id, teacher_id FROM users WHERE id = ?')
    .get(row.user_id)) as
    | {
        id: number;
        username: string;
        role: string;
        name: string;
        center_id: number | null;
        teacher_id: number | null;
      }
    | undefined;
  if (!u) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    kind: 'staff',
    name: u.name,
    center_id: u.center_id,
    teacher_id: u.teacher_id,
  };
}

/**
 * Đổi refresh token lấy cặp token mới (rotation).
 * - Token không tồn tại / hết hạn -> 401.
 * - Token đã bị revoke (dùng lại) -> thu hồi toàn bộ chuỗi của user + 401.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<TokenPair> {
  const h = hashToken(refreshToken);
  const row = (await db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(h)) as
    RefreshRow | undefined;
  if (!row) throw AppError.unauthorized('Refresh token không hợp lệ');
  if (row.revoked_at) {
    // Dùng lại token đã revoke = dấu hiệu trộm token -> thu hồi cả chuỗi.
    await revokeAllForOwner(row.kind, row.kind === 'parent' ? row.parent_id! : row.user_id!);
    throw AppError.unauthorized('Phiên đăng nhập đã bị thu hồi vì nghi ngờ bị đánh cắp');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw AppError.unauthorized('Refresh token đã hết hạn');
  }

  const user = await buildAuthUser(row);
  const pair = await issueTokenPair(user, meta);
  // Revoke token cũ trong cùng transaction logic (2 câu lệnh liên tiếp, idempotent).
  await db
    .prepare(
      'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE token_hash = ? AND revoked_at IS NULL'
    )
    .run(hashToken(pair.refresh_token), h);
  return pair;
}

/** Thu hồi 1 refresh token (logout). */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?')
    .run(hashToken(refreshToken));
}

/** Thu hồi toàn bộ refresh token của 1 user (đổi mật khẩu / nghi trộm). */
export async function revokeAllForOwner(kind: 'staff' | 'parent', ownerId: number): Promise<void> {
  const col = kind === 'parent' ? 'parent_id' : 'user_id';
  await db
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE kind = ? AND ${col} = ? AND revoked_at IS NULL`
    )
    .run(kind, ownerId);
}
