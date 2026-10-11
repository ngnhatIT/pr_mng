import crypto from 'crypto';
import { db } from '../../db';
import { signToken, AuthUser, invalidateTokenCheck } from '../../middleware/auth';
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
  /** Payload đã ký vào access token (để route trả thông tin user sau refresh). */
  user: AuthUser;
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
  return { token, refresh_token: refreshToken, expires_in: ttlToSeconds(ACCESS_TOKEN_TTL), user };
}

/** Dựng lại AuthUser từ refresh token row (để ký access token mới). */
async function buildAuthUser(row: RefreshRow): Promise<AuthUser> {
  if (row.kind === 'parent') {
    const p = (await db
      .prepare(
        'SELECT id, phone, name, center_id, token_version, is_active, must_change_password FROM parents WHERE id = ?'
      )
      .get(row.parent_id)) as
      | {
          id: number;
          phone: string;
          name: string;
          center_id: number | null;
          token_version: number;
          is_active: boolean;
          must_change_password: boolean;
        }
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
      must_change_password: !!p.must_change_password,
    };
  }
  const u = (await db
    .prepare(
      'SELECT id, username, role, name, center_id, teacher_id, token_version, is_active, must_change_password FROM users WHERE id = ?'
    )
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
        must_change_password: boolean;
      }
    | undefined;
  if (!u) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
  if (!u.is_active) throw AppError.unauthorized('Tài khoản đã bị khóa');
  // Fail-closed: user thường không có trung tâm không được cấp token (tránh scope toàn hệ thống)
  if (u.role !== 'superadmin' && u.center_id == null)
    throw AppError.forbidden('Tài khoản chưa được gán trung tâm', 'NO_CENTER');
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    kind: 'staff',
    name: u.name,
    center_id: u.center_id,
    teacher_id: u.teacher_id,
    tv: u.token_version,
    must_change_password: !!u.must_change_password,
  };
}

/** Grace period sau rotation: trong window này, dùng lại token cũ không bị coi là trộm. */
const GRACE_PERIOD_MS = 30 * 1000;

/**
 * Đổi refresh token lấy cặp token mới (rotation).
 * - Token không tồn tại / hết hạn -> 401.
 * - Token đã bị revoke do rotation trong vòng 30s (grace) -> cấp cặp mới,
 *   KHÔNG thu hồi chuỗi (chống logout oan khi 2 tab refresh đồng thời).
 * - Token đã bị revoke do rotation quá 30s -> coi là trộm -> thu hồi toàn bộ chuỗi của user + 401.
 * - Token bị revoke bởi logout/revoke-all -> 401 (không thu hồi chuỗi).
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
    // Chỉ token bị revoke DO ROTATION (replaced_by != NULL) mới là tín hiệu trộm. Token bị revoke
    // bởi logout/revoke-all chỉ là token hết hiệu lực: 401, KHÔNG thu hồi chuỗi — nếu không, thiết bị
    // vừa bị "đăng xuất mọi nơi" gọi refresh sẽ đá luôn phiên hiện tại của chính chủ.
    if (row?.revoked_at && row.replaced_by !== null) {
      const withinGrace = Date.now() - new Date(row.revoked_at).getTime() <= GRACE_PERIOD_MS;
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

/*
 * SEC-12: revoke-all còn xóa replaced_by của các token đã rotate — nếu không, token vừa rotate
 * (< 30s) vẫn lọt nhánh grace và được cấp cặp mới SAU khi user đã "đăng xuất mọi nơi"/đổi mật khẩu.
 */

/** Thu hồi toàn bộ refresh token của 1 user (đổi mật khẩu / nghi trộm). */
export async function revokeAllForOwner(kind: 'staff' | 'parent', ownerId: number): Promise<void> {
  await revokeAllForOwnerExcept(kind, ownerId);
}

/** Thu hồi mọi session trừ token hiện tại (dùng khi đổi mật khẩu / đăng xuất thiết bị khác). */
export async function revokeAllForOwnerExcept(
  kind: 'staff' | 'parent',
  ownerId: number,
  exceptToken?: string
): Promise<void> {
  const col = kind === 'parent' ? 'parent_id' : 'user_id';
  await db
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()), replaced_by = NULL
       WHERE kind = ? AND ${col} = ? AND (revoked_at IS NULL OR replaced_by IS NOT NULL) AND token_hash != ?`
    )
    .run(kind, ownerId, exceptToken ? hashToken(exceptToken) : '');
}

/**
 * Đăng xuất mọi thiết bị KHÁC: thu hồi refresh token trừ token hiện tại, tăng token_version
 * (access token bị lộ chết ngay) và trả access token mới để phiên hiện tại vẫn dùng tiếp.
 */
export async function logoutOtherSessions(user: AuthUser, currentRefreshToken?: string): Promise<string> {
  const isParent = user.kind === 'parent' || user.role === 'parent';
  const kind = isParent ? 'parent' : 'staff';
  const ownerId = isParent ? (user.parent_id ?? user.id) : user.id;
  await revokeAllForOwnerExcept(kind, ownerId, currentRefreshToken);
  const row = (await db
    .prepare(
      `UPDATE ${isParent ? 'parents' : 'users'} SET token_version = token_version + 1 WHERE id = ? RETURNING token_version`
    )
    .get(ownerId)) as { token_version: number } | undefined;
  if (!row) throw AppError.unauthorized('Phiên đăng nhập không còn hiệu lực');
  invalidateTokenCheck(kind, ownerId);
  // Payload đã verify chứa iat/exp — bỏ đi trước khi ký lại (jwt.sign từ chối exp + expiresIn)
  const { iat: _iat, exp: _exp, ...rest } = user as AuthUser & { iat?: number; exp?: number };
  return signToken({ ...rest, tv: row.token_version }, ACCESS_TOKEN_TTL);
}
