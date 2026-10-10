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
 * - Access token: JWT, sống 15 phút (ACCESS_TOKEN_TTL).
 * - Refresh token: chuỗi opaque 48 byte (lưu DB dưới dạng SHA-256 hash),
 *   sống 30 ngày, mỗi lần dùng sẽ ROTATE: revoke token cũ, cấp cặp mới.
 * - D2: JWT nhúng `tv` (token_version) — đổi pass/khóa TK tăng version thì
 *   access token cũ bị thu hồi ngay ở middleware (check mỗi request, cache 60s).
 * - Dùng lại token đã revoke -> coi như bị trộm -> thu hồi TOÀN BỘ chuỗi
 *   refresh token của user đó (theft detection).
 * - Grace period 30s sau rotation: 2 request đồng thời (vd 2 tab) dùng cùng
 *   token cũ vẫn được cấp cặp mới, không bị coi là trộm (B4).
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

/** Cấp cặp token mới cho user (dùng ở login/register).
 * refreshRaw: token thô cấp sẵn (rotateRefreshToken sinh trước để ghi
 * replaced_by nguyên tử trong cùng UPDATE claim). */
export async function issueTokenPair(
  user: AuthUser,
  meta?: { ip?: string; userAgent?: string },
  refreshRaw?: string
): Promise<TokenPair> {
  const token = signToken(user, ACCESS_TOKEN_TTL);
  const refreshToken = refreshRaw ?? newRefreshToken();
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
      .prepare('SELECT id, phone, name, center_id, token_version, is_active FROM parents WHERE id = ?')
      .get(row.parent_id)) as
      | { id: number; phone: string; name: string; center_id: number | null; token_version: number; is_active: boolean }
      | undefined;
    if (!p) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
    if (!p.is_active) throw AppError.unauthorized('Tài khoản đã bị khóa');
    return {
      id: p.id,
      username: p.phone,
      role: 'parent',
      kind: 'parent',
      name: p.name,
      center_id: p.center_id,
      parent_id: p.id,
      tv: p.token_version,
    };
  }
  const u = (await db
    .prepare('SELECT id, username, role, name, center_id, teacher_id, token_version, is_active FROM users WHERE id = ?')
    .get(row.user_id)) as
    | {
        id: number;
        username: string;
        role: string;
        name: string;
        center_id: number | null;
        teacher_id: number | null;
        token_version: number;
        is_active: boolean;
      }
    | undefined;
  if (!u) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
  if (!u.is_active) throw AppError.unauthorized('Tài khoản đã bị khóa');
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    kind: 'staff',
    name: u.name,
    center_id: u.center_id,
    teacher_id: u.teacher_id,
    tv: u.token_version,
  };
}

/** Grace period sau rotation: trong window này, dùng lại token cũ không bị coi là trộm. */
const GRACE_PERIOD_MS = 30 * 1000;

/**
 * Đổi refresh token lấy cặp token mới (rotation).
 * - Token không tồn tại / hết hạn -> 401.
 * - Token đã bị revoke do rotation trong vòng 30s (grace) -> cấp cặp mới,
 *   KHÔNG thu hồi chuỗi (chống logout oan khi 2 tab refresh đồng thời).
 * - Token đã bị revoke quá 30s (hoặc revoke không phải do rotation: logout,
 *   revoke-all) -> coi là trộm -> thu hồi toàn bộ chuỗi của user + 401.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<TokenPair> {
  const h = hashToken(refreshToken);
  // Sinh sẵn token thay thế TRƯỚC khi claim để ghi replaced_by nguyên tử
  // trong cùng UPDATE: request thua trong race luôn thấy replaced_by đã set.
  const nextRefreshRaw = newRefreshToken();
  // Atomic claim: UPDATE...RETURNING để 2 request đồng thời chỉ 1 thành công
  // (tránh race: cả 2 cùng SELECT thấy chưa revoke rồi cùng cấp token mới)
  const claimed = (await db
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
       RETURNING *`
    )
    .get(hashToken(nextRefreshRaw), h)) as RefreshRow | undefined;

  if (!claimed) {
    // Không claim được: kiểm tra xem là token không tồn tại hay đã bị dùng lại (theft)
    const row = (await db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(h)) as
      RefreshRow | undefined;
    if (row?.revoked_at) {
      const withinGrace =
        row.replaced_by !== null &&
        Date.now() - new Date(row.revoked_at).getTime() <= GRACE_PERIOD_MS;
      if (withinGrace) {
        // Request đồng thời hợp lệ: cấp cặp mới thay vì thu hồi chuỗi.
        // (Không trả lại cặp đã cấp ở replaced_by vì DB chỉ lưu hash, không lưu token thô.)
        const user = await buildAuthUser(row);
        return issueTokenPair(user, meta);
      }
      // Dùng lại token đã revoke ngoài grace window = dấu hiệu trộm token -> thu hồi cả chuỗi.
      await revokeAllForOwner(row.kind, row.kind === 'parent' ? row.parent_id! : row.user_id!);
      throw AppError.unauthorized('Phiên đăng nhập đã bị thu hồi vì nghi ngờ bị đánh cắp');
    }
    throw AppError.unauthorized('Refresh token không hợp lệ hoặc đã hết hạn');
  }

  const user = await buildAuthUser(claimed);
  return issueTokenPair(user, meta, nextRefreshRaw);
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

/** Thu hồi mọi session trừ token hiện tại (dùng khi đổi mật khẩu). */
export async function revokeAllForOwnerExcept(
  kind: 'staff' | 'parent',
  ownerId: number,
  exceptToken?: string
): Promise<void> {
  const col = kind === 'parent' ? 'parent_id' : 'user_id';
  if (exceptToken) {
    const hash = hashToken(exceptToken);
    await db
      .prepare(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE kind = ? AND ${col} = ? AND revoked_at IS NULL AND token_hash != ?`
      )
      .run(kind, ownerId, hash);
  } else {
    await revokeAllForOwner(kind, ownerId);
  }
}
