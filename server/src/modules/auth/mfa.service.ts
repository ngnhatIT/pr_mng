import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { AppError } from '../../shared/errors';
import { audit, type AuditActor } from '../../shared/audit';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '../../shared/totp';

interface MfaRow {
  id: number;
  username: string;
  password_hash: string;
  center_id: number | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: string | number | null;
  totp_recovery: string[] | null;
}

const ISSUER = 'EduCenter Pro';

/**
 * Chống dò mã 6 số: sai MAX_FAILURES lần liên tiếp -> khóa bước 2FA của tài khoản LOCK_MS (mọi IP, mọi mfa_token).
 * ponytail: đếm trong bộ nhớ từng process (nhiều worker PM2 = nhân số lần thử); chuyển sang bảng DB nếu cần chặt hơn.
 */
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<number, { n: number; until: number }>();

function assertNotLocked(userId: number): void {
  const f = failures.get(userId);
  if (f && f.until > Date.now()) {
    throw AppError.tooManyRequests('Nhập sai mã quá nhiều lần, vui lòng thử lại sau 15 phút', 'MFA_LOCKED');
  }
}

function recordFailure(userId: number): void {
  const f = failures.get(userId);
  const n = (f && f.until <= Date.now() && f.n >= MAX_FAILURES ? 0 : (f?.n ?? 0)) + 1;
  failures.set(userId, { n, until: n >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
}

/** Secret giải mã được không (đổi DATA_ENCRYPTION_KEY/JWT_SECRET -> không) — khi đó vẫn cho dùng mã khôi phục. */
function trySecret(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

/** Chỉ dùng trong test. */
export function _resetMfaFailures(): void {
  failures.clear();
}

async function row(userId: number): Promise<MfaRow> {
  const r = (await db
    .prepare(
      'SELECT id, username, password_hash, center_id, totp_secret, totp_enabled, totp_last_step, totp_recovery FROM users WHERE id = ?'
    )
    .get(userId)) as MfaRow | undefined;
  if (!r) throw AppError.notFound('Không tìm thấy tài khoản');
  return r;
}

export async function mfaStatus(userId: number): Promise<{ enabled: boolean; recovery_left: number }> {
  const r = await row(userId);
  return { enabled: r.totp_enabled, recovery_left: r.totp_enabled ? (r.totp_recovery?.length ?? 0) : 0 };
}

/** Bước 1: tạo secret mới (chưa bật). Gọi lại khi chưa bật = thay secret cũ. */
export async function mfaSetup(userId: number): Promise<{ secret: string; otpauth_url: string }> {
  const r = await row(userId);
  if (r.totp_enabled) throw AppError.conflict('Xác thực 2 lớp đang bật', 'MFA_ALREADY_ENABLED');
  const secret = generateTotpSecret();
  await db
    .prepare('UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?')
    .run(encryptSecret(secret), userId);
  return { secret, otpauth_url: otpauthUrl(ISSUER, r.username, secret) };
}

/** Bước 2: nhập mã từ app để xác nhận -> bật + trả mã khôi phục (hiện 1 lần). */
export async function mfaEnable(
  userId: number,
  code: string,
  actor?: AuditActor
): Promise<{ recovery_codes: string[] }> {
  const r = await row(userId);
  if (r.totp_enabled) throw AppError.conflict('Xác thực 2 lớp đang bật', 'MFA_ALREADY_ENABLED');
  const secret = trySecret(r.totp_secret);
  if (!secret) throw AppError.badRequest('Chưa thiết lập, hãy bắt đầu lại', 'MFA_NOT_SETUP');
  const step = verifyTotp(secret, code);
  if (step === null) throw AppError.badRequest('Mã xác thực không đúng', 'MFA_INVALID_CODE');
  const codes = generateRecoveryCodes();
  await db
    .prepare(
      'UPDATE users SET totp_enabled = true, totp_last_step = ?, totp_recovery = ?::jsonb WHERE id = ?'
    )
    .run(step, JSON.stringify(codes.map(hashRecoveryCode)), userId);
  await audit({
    centerId: r.center_id,
    actor,
    action: 'update',
    entity: 'users',
    entityId: userId,
    summary: 'Bật xác thực 2 lớp',
  });
  return { recovery_codes: codes };
}

/**
 * Kiểm tra mã lúc đăng nhập (hoặc lúc tắt): mã TOTP (chặn dùng lại bước cũ, cập nhật nguyên tử) hoặc mã khôi phục
 * (xóa khỏi danh sách sau khi dùng). Trả 'totp' | 'recovery' | null.
 */
export async function consumeSecondFactor(userId: number, code: string): Promise<'totp' | 'recovery' | null> {
  assertNotLocked(userId);
  const used = await checkSecondFactor(userId, code);
  if (used) failures.delete(userId);
  else recordFailure(userId);
  return used;
}

async function checkSecondFactor(userId: number, code: string): Promise<'totp' | 'recovery' | null> {
  const r = await row(userId);
  if (!r.totp_enabled) return null;
  const last = r.totp_last_step === null ? null : Number(r.totp_last_step);
  const secret = trySecret(r.totp_secret);
  const step = secret ? verifyTotp(secret, code, last) : null;
  if (step !== null) {
    // 2 request cùng mã đồng thời: chỉ 1 cái cập nhật được (điều kiện step > last)
    const u = await db
      .prepare(
        'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)'
      )
      .run(step, userId, step);
    return u.changes ? 'totp' : null;
  }
  const h = hashRecoveryCode(code);
  if (!(r.totp_recovery ?? []).includes(h)) return null;
  const u = await db
    .prepare(
      `UPDATE users SET totp_recovery = COALESCE(totp_recovery, '[]'::jsonb) - ?::text
       WHERE id = ? AND jsonb_exists(totp_recovery, ?)` // không dùng toán tử ? (trùng placeholder)
    )
    .run(h, userId, h);
  return u.changes ? 'recovery' : null;
}

/** Tắt 2FA: cần mật khẩu + mã hiện tại (hoặc mã khôi phục). */
export async function mfaDisable(
  userId: number,
  password: string,
  code: string,
  actor?: AuditActor
): Promise<void> {
  const r = await row(userId);
  if (!r.totp_enabled) throw AppError.badRequest('Xác thực 2 lớp chưa bật', 'MFA_NOT_ENABLED');
  if (!(await bcrypt.compare(String(password ?? ''), r.password_hash))) {
    throw AppError.badRequest('Mật khẩu không đúng', 'WRONG_PASSWORD');
  }
  if (!(await consumeSecondFactor(userId, code)))
    throw AppError.badRequest('Mã xác thực không đúng', 'MFA_INVALID_CODE');
  await db
    .prepare(
      'UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL, totp_recovery = NULL WHERE id = ?'
    )
    .run(userId);
  await audit({
    centerId: r.center_id,
    actor,
    action: 'update',
    entity: 'users',
    entityId: userId,
    summary: 'Tắt xác thực 2 lớp',
  });
}
