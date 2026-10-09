/** Unit test cho services/vnpay.ts — ký & xác thực chữ ký HMAC-SHA512 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildVnpayUrl, verifyVnpayReturn } from './vnpay';

const SECRET = 'test-secret-123';
const CFG = { tmnCode: 'TMNTEST', hashSecret: SECRET, returnUrl: 'https://example.com/return' };

/** Giả lập VNPay ký lại params trả về (giống thuật toán trong vnpay.ts). */
function vnpaySign(params: Record<string, string>): string {
  const signData = Object.keys(params)
    .filter((k) => k.startsWith('vnp_'))
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHmac('sha512', SECRET).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(url).searchParams.entries()) out[k] = v;
  return out;
}

describe('vnpay', () => {
  it('buildVnpayUrl tạo URL sandbox có đủ tham số bắt buộc', () => {
    const url = buildVnpayUrl(CFG, {
      amountVnd: 500000,
      txnRef: 'INV1_1700000000',
      orderInfo: 'Hoc phi',
      ipAddr: '1.2.3.4',
    });
    assert.ok(url.startsWith('https://sandbox.vnpayment.vn/'));
    const q = parseQuery(url);
    assert.equal(q.vnp_TmnCode, 'TMNTEST');
    assert.equal(q.vnp_Amount, String(500000 * 100));
    assert.equal(q.vnp_TxnRef, 'INV1_1700000000');
    assert.ok(q.vnp_SecureHash && q.vnp_SecureHash.length === 128);
  });

  it('verifyVnpayReturn: chữ ký hợp lệ + ResponseCode=00 -> success', () => {
    const url = buildVnpayUrl(CFG, { amountVnd: 250000, txnRef: 'INV9_1', orderInfo: 'Hoc phi', ipAddr: '' });
    const q = parseQuery(url);
    delete q.vnp_SecureHash; // VNPay ký lại toàn bộ params trả về
    q.vnp_ResponseCode = '00';
    q.vnp_TransactionNo = '999';
    q.vnp_SecureHash = vnpaySign(q);
    const r = verifyVnpayReturn(q, SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.success, true);
    assert.equal(r.txnRef, 'INV9_1');
    assert.equal(r.amountVnd, 250000);
  });

  it('verifyVnpayReturn: sai secret -> ok=false', () => {
    const q: Record<string, string> = { vnp_TxnRef: 'X', vnp_Amount: '1000000', vnp_SecureHash: 'sai' };
    const r = verifyVnpayReturn(q, SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.success, false);
  });

  it('verifyVnpayReturn: ResponseCode != 00 -> success=false nhưng ok=true', () => {
    const base: Record<string, string> = { vnp_TxnRef: 'X', vnp_Amount: '1000000', vnp_ResponseCode: '24' };
    base.vnp_SecureHash = vnpaySign(base);
    const r = verifyVnpayReturn(base, SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.success, false);
  });
});
