import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  maskAccessToken,
  formatMoneyVND,
  formatDueDate,
  buildDedupKey,
  sendZNS,
  ZaloTokenError,
  ZaloQuotaError,
} from './zalo.js';

/**
 * Test cho Zalo service — module gửi tiền thật (ZNS tính phí/tin).
 * Các hàm pure (không gọi API) phải đúng 100% để tránh gửi sai.
 */
describe('normalizePhone', () => {
  it('chấp nhận 09xxxxxxxx', () => {
    assert.equal(normalizePhone('0901234567'), '0901234567');
  });
  it('chấp nhận +849xxxxxxxx', () => {
    assert.equal(normalizePhone('+84901234567'), '0901234567');
  });
  it('chấp nhận 849xxxxxxxx (11 số)', () => {
    assert.equal(normalizePhone('84901234567'), '0901234567');
  });
  it('loại bỏ khoảng trắng/dấu chấm/gạch', () => {
    assert.equal(normalizePhone('0901 234 567'), '0901234567');
    assert.equal(normalizePhone('0901.234.567'), '0901234567');
    assert.equal(normalizePhone('0901-234-567'), '0901234567');
  });
  it('từ chối số không hợp lệ', () => {
    assert.equal(normalizePhone('123'), null);
    assert.equal(normalizePhone('090123456'), null); // 9 số
    assert.equal(normalizePhone('09012345678'), null); // 11 số
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone(undefined), null);
  });
});

describe('maskAccessToken', () => {
  it('che giữa token', () => {
    assert.equal(maskAccessToken('abcdefghij123456'), 'abcd••••••••3456');
  });
  it('token ngắn che hết', () => {
    assert.equal(maskAccessToken('abc'), '••••••••');
  });
  it('token rỗng', () => {
    assert.equal(maskAccessToken(''), '');
  });
});

describe('formatMoneyVND', () => {
  it('format tiền Việt', () => {
    assert.equal(formatMoneyVND(1000000), '1.000.000đ');
    assert.equal(formatMoneyVND(0), '0đ');
  });
  it('làm tròn', () => {
    assert.equal(formatMoneyVND(999.6), '1.000đ');
  });
});

describe('formatDueDate', () => {
  it('format YYYY-MM-DD sang DD/MM/YYYY', () => {
    assert.equal(formatDueDate('2026-10-15'), '15/10/2026');
  });
  it('null trả gạch ngang', () => {
    assert.equal(formatDueDate(null), '—');
  });
});

describe('buildDedupKey', () => {
  it('ghép invoiceId:kind:ngày', () => {
    assert.equal(buildDedupKey(123, 'overdue', '2026-10-10'), '123:overdue:2026-10-10');
  });
  it('khác loại hoặc khác ngày cho key khác nhau', () => {
    assert.notEqual(buildDedupKey(1, 'overdue', '2026-10-10'), buildDedupKey(1, 'upcoming', '2026-10-10'));
    assert.notEqual(buildDedupKey(1, 'overdue', '2026-10-10'), buildDedupKey(1, 'overdue', '2026-10-11'));
  });
});

describe('sendZNS phân loại mã lỗi', () => {
  const realFetch = globalThis.fetch;
  const znsParams = {
    phone: '0901234567',
    templateId: '1',
    templateData: {},
    accessToken: 'x',
  };
  // Mock fetch: Zalo trả HTTP 200 kèm error != 0 cho lỗi nghiệp vụ
  const mockZns = (body: unknown, ok = true, status = 200): void => {
    globalThis.fetch = (async () =>
      ({
        ok,
        status,
        json: async () => body,
      }) as unknown as Response) as typeof fetch;
  };
  const afterEachRestore = (): void => {
    globalThis.fetch = realFetch;
  };

  it('mã -216/-220 (token) -> ném ZaloTokenError', async () => {
    try {
      for (const code of [-216, -220]) {
        mockZns({ error: code, message: 'token bad' });
        await assert.rejects(
          () => sendZNS(znsParams),
          (e: unknown) => e instanceof ZaloTokenError && (e as ZaloTokenError).zaloCode === code
        );
      }
    } finally {
      afterEachRestore();
    }
  });

  it('mã -218 (quota) -> ném ZaloQuotaError', async () => {
    try {
      mockZns({ error: -218, message: 'Out of quota receive' });
      await assert.rejects(
        () => sendZNS(znsParams),
        (e: unknown) => e instanceof ZaloQuotaError && (e as ZaloQuotaError).zaloCode === -218
      );
    } finally {
      afterEachRestore();
    }
  });

  it('mã -7 (template) -> trả failed, không ném', async () => {
    try {
      mockZns({ error: -7, message: 'Template đã bị khóa' });
      const r1 = await sendZNS(znsParams);
      assert.equal(r1.ok, false);
      assert.equal(r1.error, 'Template đã bị khóa');
      // Lần 2 trong ngày: vẫn failed nhưng không alert nữa (không throw)
      const r2 = await sendZNS(znsParams);
      assert.equal(r2.ok, false);
    } finally {
      afterEachRestore();
    }
  });

  it('mã lỗi khác -> trả failed bình thường', async () => {
    try {
      mockZns({ error: -201, message: 'Phone number is not on Zalo' });
      const r = await sendZNS(znsParams);
      assert.equal(r.ok, false);
      assert.equal(r.error, 'Phone number is not on Zalo');
    } finally {
      afterEachRestore();
    }
  });

  it('error 0 -> ok', async () => {
    try {
      mockZns({ error: 0, message: 'Success', data: { msg_id: 'abc' } });
      const r = await sendZNS(znsParams);
      assert.equal(r.ok, true);
    } finally {
      afterEachRestore();
    }
  });
});
