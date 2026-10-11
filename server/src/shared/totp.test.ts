process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test');

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  otpauthUrl,
  totpAt,
  verifyTotp,
  signMfaToken,
  verifyMfaToken,
  generateRecoveryCodes,
  hashRecoveryCode,
} from './totp';
import { signToken } from '../middleware/auth';

// Vector chuẩn RFC 6238 phụ lục B (SHA1, secret ASCII "12345678901234567890")
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('khớp vector RFC 6238 (6 chữ số cuối)', () => {
    assert.equal(totpAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
    assert.equal(totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
    assert.equal(totpAt(RFC_SECRET, Math.floor(2000000000 / 30)), '279037');
    assert.equal(base32Decode(RFC_SECRET).toString(), '12345678901234567890');
  });

  it('chấp nhận lệch ±1 bước, chặn dùng lại cùng bước, chặn mã sai định dạng', () => {
    const now = 1111111109 * 1000;
    const step = Math.floor(1111111109 / 30);
    assert.equal(verifyTotp(RFC_SECRET, '081804', null, now), step);
    assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), null, now), step - 1);
    assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), null, now), null);
    assert.equal(verifyTotp(RFC_SECRET, '081804', step, now), null, 'replay');
    assert.equal(verifyTotp(RFC_SECRET, '08180', null, now), null);
  });

  it('mã hóa secret 2 chiều, ciphertext khác nhau mỗi lần, sửa 1 byte thì lỗi', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    assert.notEqual(a, encryptSecret('JBSWY3DPEHPK3PXP'));
    assert.equal(decryptSecret(a), 'JBSWY3DPEHPK3PXP');
    const parts = a.split(':');
    parts[3] = Buffer.from(
      'x' + Buffer.from(parts[3], 'base64').toString('latin1').slice(1),
      'latin1'
    ).toString('base64');
    assert.throws(() => decryptSecret(parts.join(':')));
  });

  it('token bước 2 không dùng chéo với access token', () => {
    assert.equal(verifyMfaToken(signMfaToken(5)), 5);
    assert.equal(verifyMfaToken(signToken({ id: 5, username: 'a', role: 'admin', name: 'A' })), null);
  });

  it('otpauth URL + mã khôi phục', () => {
    assert.match(
      otpauthUrl('EduCenter Pro', 'admin', 'ABC'),
      /^otpauth:\/\/totp\/EduCenter%20Pro%3Aadmin\?secret=ABC&issuer=/
    );
    const codes = generateRecoveryCodes();
    assert.equal(new Set(codes).size, 8);
    assert.match(codes[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    assert.equal(hashRecoveryCode(codes[0].toLowerCase().replace('-', ' ')), hashRecoveryCode(codes[0]));
  });
});
