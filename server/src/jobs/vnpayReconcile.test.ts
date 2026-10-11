/** Unit test cho G6 (đơn VNPay treo) — phần thuần, không cần DB/mạng. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vnWallToVnpDate, classifyQuerydr } from './vnpayReconcile';
import { buildVnpayUrl } from '../services/vnpay';

function vnpToMs(s: string): number {
  return Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
    Number(s.slice(12, 14))
  );
}

describe('G6: đơn VNPay treo', () => {
  it("vnWallToVnpDate: 'YYYY-MM-DD HH:MM:SS' → 'yyyyMMddHHmmss'", () => {
    assert.equal(vnWallToVnpDate('2026-10-10 14:30:05'), '20261010143005');
    assert.equal(vnWallToVnpDate('2026-01-02 03:04:05'), '20260102030405');
    assert.equal(vnWallToVnpDate('không phải ngày'), '');
  });

  it('buildVnpayUrl có vnp_ExpireDate = vnp_CreateDate + 30 phút', () => {
    const url = buildVnpayUrl(
      { tmnCode: 'TEST', hashSecret: 'secret', returnUrl: 'https://x.test/return' },
      { amountVnd: 100000, txnRef: 'HD1_123', orderInfo: 'test', ipAddr: '127.0.0.1' }
    );
    const q = new URL(url).searchParams;
    const create = q.get('vnp_CreateDate');
    const expire = q.get('vnp_ExpireDate');
    assert.ok(/^\d{14}$/.test(create ?? ''), 'vnp_CreateDate đúng định dạng');
    assert.ok(/^\d{14}$/.test(expire ?? ''), 'vnp_ExpireDate đúng định dạng');
    assert.equal(vnpToMs(expire!) - vnpToMs(create!), 30 * 60 * 1000);
  });

  it('DATA-13: querydr lỗi tạm thời / VNPay đang xử lý -> retry (giữ pending), chỉ fail khi dứt khoát', () => {
    const q = (ok: boolean, responseCode: string, transactionStatus: string) =>
      classifyQuerydr({ ok, responseCode, transactionStatus });
    assert.equal(q(false, '', ''), 'retry'); // timeout / sai chữ ký phản hồi
    assert.equal(q(true, '99', ''), 'retry');
    assert.equal(q(true, '00', '01'), 'retry'); // VNPay chưa hoàn tất
    assert.equal(q(true, '00', '00'), 'confirm');
    assert.equal(q(true, '00', '02'), 'fail');
    assert.equal(q(true, '91', ''), 'fail'); // không có giao dịch
  });
});
