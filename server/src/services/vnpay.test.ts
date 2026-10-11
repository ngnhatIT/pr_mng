/**
 * Unit test cho services/vnpay.ts — chữ ký HMAC-SHA512 VNPay 2.1.0.
 * TEST-2/PAY-1: KHÔNG dùng lại code production để ký. Bên "VNPay" trong test là bản chép độc lập
 * thuật toán mẫu Node chính thức của VNPay (sortObject + qs.stringify({encode:false})),
 * cộng 1 vector cố định (chuỗi ký viết tay + HMAC tính bằng `openssl dgst -sha512 -hmac`).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { buildVnpayUrl, verifyVnpayReturn, queryVnpayTransaction } from './vnpay';

const SECRET = 'VNPAYTESTSECRET';
const CFG = {
  tmnCode: 'TMNTEST',
  hashSecret: SECRET,
  returnUrl: 'https://x.vn/api/v1/payments/vnpay-return',
};

/** Chép từ sample vnpay_nodejs của VNPay (sortObject). */
function sortObject(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const str: string[] = [];
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) str.push(encodeURIComponent(key));
  }
  str.sort();
  for (let i = 0; i < str.length; i++) {
    sorted[str[i]] = encodeURIComponent(obj[str[i]]).replace(/%20/g, '+');
  }
  return sorted;
}

/** Như VNPay ký: sortObject -> stringify không encode lại -> HMAC-SHA512 hex. */
function officialSign(params: Record<string, string>): string {
  const signData = querystring.stringify(sortObject(params), '&', '=', {
    encodeURIComponent: (s: string) => s,
  });
  return crypto.createHmac('sha512', SECRET).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

/** Tách query thô (chưa decode) của URL thành chuỗi ký + secure hash. */
function splitUrl(url: string): { signData: string; hash: string } {
  const qs = url.slice(url.indexOf('?') + 1);
  const i = qs.indexOf('&vnp_SecureHash=');
  return { signData: qs.slice(0, i), hash: qs.slice(i + '&vnp_SecureHash='.length) };
}

/** Express decode query: '+' -> ' ', %XX -> ký tự (giống những gì handler nhận). */
function decodeQuery(qs: string): Record<string, string> {
  return querystring.parse(qs) as Record<string, string>;
}

const FIXED = {
  amountVnd: 100000,
  txnRef: 'HD12_1700000000000',
  orderInfo: 'Thanh toán học phí HD12',
  ipAddr: '127.0.0.1',
  createDate: '20261010143000',
};
const FIXED_SIGN_DATA =
  'vnp_Amount=10000000&vnp_Command=pay&vnp_CreateDate=20261010143000&vnp_CurrCode=VND' +
  '&vnp_ExpireDate=20261010150000&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+hoc+phi+HD12' +
  '&vnp_OrderType=other&vnp_ReturnUrl=https%3A%2F%2Fx.vn%2Fapi%2Fv1%2Fpayments%2Fvnpay-return' +
  '&vnp_TmnCode=TMNTEST&vnp_TxnRef=HD12_1700000000000&vnp_Version=2.1.0';
const FIXED_HASH =
  'bb732b43ce4f2951d88ad8c71ad7e87dca5ab66e292c14d684860676f92e667662d43c51d3be94a6e7a7731c1c6f0efb3b3d8fcffb2448254e08c8e8ef605fa6';

describe('vnpay — URL thanh toán (PAY-1)', () => {
  it('vector cố định: chuỗi ký encode giá trị (khoảng trắng -> +, URL -> %3A%2F) và hash khớp openssl', () => {
    const url = buildVnpayUrl(CFG, FIXED);
    assert.ok(url.startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?'));
    const { signData, hash } = splitUrl(url);
    assert.equal(signData, FIXED_SIGN_DATA);
    assert.equal(hash, FIXED_HASH);
  });

  it('khớp thuật toán mẫu chính thức của VNPay (ký độc lập trên params đã decode)', () => {
    const url = buildVnpayUrl(CFG, { ...FIXED, createDate: undefined, orderInfo: 'Học phí T10 & phụ thu' });
    const { signData, hash } = splitUrl(url);
    assert.equal(officialSign(decodeQuery(signData)), hash);
  });

  it('createDate tái sử dụng -> giữ nguyên vnp_CreateDate, vnp_ExpireDate = +30 phút', () => {
    const q = decodeQuery(splitUrl(buildVnpayUrl(CFG, FIXED)).signData);
    assert.equal(q.vnp_CreateDate, '20261010143000');
    assert.equal(q.vnp_ExpireDate, '20261010150000');
  });
});

describe('vnpay — verify return/IPN (PAY-1, PAY-6)', () => {
  /** Query VNPay gửi về (VNPay ký bằng thuật toán chính thức), sau khi Express decode. */
  function vnpayCallback(extra: Record<string, string> = {}): Record<string, string> {
    const p: Record<string, string> = {
      vnp_Amount: '25000000',
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: 'Thanh toan hoc phi HD9',
      vnp_PayDate: '20261010143500',
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TMNTEST',
      vnp_TransactionNo: '14000000',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: 'HD9_1',
      ...extra,
    };
    return { ...p, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: officialSign(p) };
  }

  it('chữ ký VNPay hợp lệ (có khoảng trắng trong OrderInfo) -> ok + success', () => {
    const r = verifyVnpayReturn(vnpayCallback(), SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.success, true);
    assert.equal(r.txnRef, 'HD9_1');
    assert.equal(r.amountVnd, 250000);
  });

  it('key không phải vnp_* (VD tham số rác do proxy thêm) không ảnh hưởng chữ ký', () => {
    const q = { ...vnpayCallback(), utm_source: 'x' };
    assert.equal(verifyVnpayReturn(q, SECRET).ok, true);
  });

  it('sửa số tiền sau khi ký -> ok=false', () => {
    const q = vnpayCallback();
    q.vnp_Amount = '99900000';
    assert.equal(verifyVnpayReturn(q, SECRET).ok, false);
  });

  it('sai secret / secret rỗng -> ok=false', () => {
    assert.equal(verifyVnpayReturn(vnpayCallback(), 'khac').ok, false);
    assert.equal(verifyVnpayReturn(vnpayCallback(), '').ok, false);
  });

  it('ResponseCode != 00 hoặc TransactionStatus != 00 -> success=false nhưng ok=true', () => {
    const a = verifyVnpayReturn(
      vnpayCallback({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
      SECRET
    );
    assert.equal(a.ok, true);
    assert.equal(a.success, false);
    const b = verifyVnpayReturn(vnpayCallback({ vnp_TransactionStatus: '02' }), SECRET);
    assert.equal(b.ok, true);
    assert.equal(b.success, false);
  });
});

describe('vnpay — querydr checksum pipe (PAY-4)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const hmac = (s: string) => crypto.createHmac('sha512', SECRET).update(s).digest('hex');

  it('vector cố định request (openssl)', () => {
    assert.equal(
      hmac('REQ1|2.1.0|querydr|TMNTEST|HD12_1|20261010143000|20261010160000|127.0.0.1|Doi soat HD12'),
      '282872d44823d7dac5db59fd13e7afb174733a7aa30037932d315f4b352b47c2a04197444a02ffe45102e3b86590688a86c06a4d5ae907d7a231d89802253241'
    );
  });

  function mockVnpay(response: (req: Record<string, string>) => Record<string, string>) {
    const sent: Record<string, string>[] = [];
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      sent.push(body);
      return { ok: true, status: 200, json: async () => response(body) } as Response;
    }) as typeof fetch;
    return sent;
  }

  function signedResponse(
    req: Record<string, string>,
    over: Record<string, string> = {}
  ): Record<string, string> {
    const r: Record<string, string> = {
      vnp_ResponseId: 'RES1',
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'QueryDR Success',
      vnp_TmnCode: req.vnp_TmnCode,
      vnp_TxnRef: req.vnp_TxnRef,
      vnp_Amount: '10000000',
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261010143500',
      vnp_TransactionNo: '14000001',
      vnp_TransactionType: '01',
      vnp_TransactionStatus: '00',
      vnp_OrderInfo: 'Thanh toan',
      vnp_PromotionCode: '',
      vnp_PromotionAmount: '',
      ...over,
    };
    const order = [
      'vnp_ResponseId',
      'vnp_Command',
      'vnp_ResponseCode',
      'vnp_Message',
      'vnp_TmnCode',
      'vnp_TxnRef',
      'vnp_Amount',
      'vnp_BankCode',
      'vnp_PayDate',
      'vnp_TransactionNo',
      'vnp_TransactionType',
      'vnp_TransactionStatus',
      'vnp_OrderInfo',
      'vnp_PromotionCode',
      'vnp_PromotionAmount',
    ];
    return { ...r, vnp_SecureHash: hmac(order.map((k) => r[k] ?? '').join('|')) };
  }

  it('request ký theo thứ tự tài liệu; vnp_TransactionDate = ngày tạo đã lưu; phản hồi hợp lệ -> ok', async () => {
    const sent = mockVnpay((req) => signedResponse(req));
    const r = await queryVnpayTransaction(CFG, {
      txnRef: 'HD12_1',
      orderInfo: 'Đối soát HD12',
      transactionDate: '20261010143000',
    });
    const q = sent[0];
    const expected = [
      q.vnp_RequestId,
      '2.1.0',
      'querydr',
      'TMNTEST',
      'HD12_1',
      '20261010143000',
      q.vnp_CreateDate,
      q.vnp_IpAddr,
      'Doi soat HD12',
    ].join('|');
    assert.equal(q.vnp_SecureHash, hmac(expected));
    assert.equal(r.ok, true);
    assert.equal(r.transactionStatus, '00');
  });

  it('phản hồi bị sửa sau khi ký -> ok=false', async () => {
    mockVnpay((req) => ({ ...signedResponse(req), vnp_TransactionStatus: '02' }));
    const r = await queryVnpayTransaction(CFG, {
      txnRef: 'HD12_1',
      orderInfo: 'x',
      transactionDate: '20261010143000',
    });
    assert.equal(r.ok, false);
  });
});
