import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Xác thực 2 lớp (TOTP, RFC 6238 — Google Authenticator / Microsoft Authenticator / 1Password...):
 * HMAC-SHA1, 6 số, bước 30 giây, chấp nhận lệch ±1 bước. Không cần thư viện ngoài.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret 160 bit (khuyến nghị RFC 4226), dạng base32. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

/**
 * Kiểm tra mã: trả về bước thời gian khớp (để chặn dùng lại cùng mã) hoặc null.
 * lastStep: bước đã dùng gần nhất của user — mã ở bước <= lastStep bị từ chối (chống replay).
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  lastStep: number | null = null,
  now = Date.now()
): number | null {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = totpAt(secretB32, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

/** Link otpauth:// (mở thẳng app xác thực trên điện thoại; app nào cũng cho nhập tay secret). */
export function otpauthUrl(issuer: string, account: string, secretB32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q}`;
}

/* ------------------------- Mã hóa secret lưu DB (AES-256-GCM) ------------------------- */

// ponytail: khóa dẫn xuất từ DATA_ENCRYPTION_KEY (nếu có) hoặc JWT_SECRET; đổi khóa = mọi user phải bật lại 2FA.
const dataKey = () =>
  crypto
    .createHash('sha256')
    .update(`totp:${process.env.DATA_ENCRYPTION_KEY || env.JWT_SECRET}`)
    .digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1') throw new Error('Định dạng secret không hỗ trợ');
  const d = crypto.createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

/* ------------------------- Mã khôi phục (dùng 1 lần) ------------------------- */

export const hashRecoveryCode = (code: string) =>
  crypto
    .createHash('sha256')
    .update(code.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');

/** 8 mã dạng XXXX-XXXX (hiện cho user 1 lần, DB chỉ lưu hash). */
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.randomBytes(5)).slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

/* ------------------------- Token bước 2 của đăng nhập ------------------------- */

// Khóa ký RIÊNG: token này không bao giờ qua được requireAuth như access token.
const mfaKey = () => crypto.createHmac('sha256', env.JWT_SECRET).update('mfa-login').digest('hex');

export function signMfaToken(userId: number): string {
  return jwt.sign({ sub: String(userId), purpose: 'mfa' }, mfaKey(), { expiresIn: '5m' });
}

export function verifyMfaToken(token: string): number | null {
  try {
    const p = jwt.verify(token, mfaKey()) as { sub?: string; purpose?: string };
    return p.purpose === 'mfa' && p.sub ? Number(p.sub) : null;
  } catch {
    return null;
  }
}
