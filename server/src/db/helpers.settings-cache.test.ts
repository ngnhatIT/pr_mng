/**
 * Unit test cho FIX chịu tải #4: getCenterSettings cache 60s.
 *
 * Không cần PostgreSQL thật: mock db.prepare, đếm số query chạm bảng
 * center_settings để chứng minh (1) lần gọi thứ 2 không query DB,
 * (2) setCenterSetting xóa cache nên lần gọi sau query lại DB.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
// Pool chỉ kết nối khi có query thật; test này mock hết nên URL giả là đủ.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './pg-compat';
import { getCenterSettings, setCenterSetting, invalidateCenterSettings } from './helpers';

const origPrepare = db.prepare;
let centerQueryCount: number;
let settingRows: { key: string; value: string | null }[];

function stmt() {
  return {
    get: async (..._args: unknown[]) => undefined,
    all: async (..._args: unknown[]) => settingRows,
    run: async (..._args: unknown[]) => ({ lastInsertRowid: 0, changes: 1 }),
  };
}

beforeEach(() => {
  centerQueryCount = 0;
  settingRows = [];
  invalidateCenterSettings(1); // cache từ test trước không rò sang
  (db as { prepare: unknown }).prepare = (sql: string) => {
    if (sql.includes('center_settings')) centerQueryCount++;
    return stmt();
  };
});

after(() => {
  db.prepare = origPrepare;
});

const KEYS = ['pay_bank_code', 'pay_bank_account_no', 'pay_bank_account_name'];

describe('getCenterSettings — cache 60s', () => {
  it('lần gọi thứ 2 với cùng keys không query DB', async () => {
    settingRows = KEYS.map((key) => ({ key, value: `v-${key}` }));
    const first = await getCenterSettings(1, KEYS);
    assert.equal(centerQueryCount, 1, 'lần đầu phải query DB đúng 1 lần');
    assert.equal(first.get('pay_bank_code'), 'v-pay_bank_code');

    const second = await getCenterSettings(1, KEYS);
    assert.equal(centerQueryCount, 1, 'lần 2 phải dùng cache, không query thêm');
    assert.deepEqual([...second.entries()], [...first.entries()], 'kết quả cache phải giống lần đầu');
  });

  it('key list khác nhau thì query riêng, thứ tự keys không tạo cache trùng', async () => {
    settingRows = [{ key: 'a', value: '1' }];
    await getCenterSettings(1, ['a', 'b']);
    await getCenterSettings(1, ['b', 'a']); // cùng tập keys, thứ tự khác
    assert.equal(centerQueryCount, 1, 'cùng tập keys chỉ query 1 lần dù thứ tự khác');
    await getCenterSettings(1, ['a', 'c']); // tập keys khác
    assert.equal(centerQueryCount, 2, 'tập keys khác phải query riêng');
  });

  it('keys rỗng không chạm DB và không cache', async () => {
    const out = await getCenterSettings(1, []);
    assert.equal(out.size, 0);
    assert.equal(centerQueryCount, 0);
  });
});

describe('setCenterSetting — xóa cache', () => {
  it('sau setCenterSetting, getCenterSettings query lại DB và thấy giá trị mới', async () => {
    settingRows = KEYS.map((key) => ({ key, value: 'old' }));
    await getCenterSettings(1, KEYS);
    await getCenterSettings(1, KEYS);
    assert.equal(centerQueryCount, 1);

    await setCenterSetting(1, 'pay_bank_code', 'new'); // phải xóa cache center 1

    settingRows = KEYS.map((key) => ({ key, value: key === 'pay_bank_code' ? 'new' : 'old' }));
    const after = await getCenterSettings(1, KEYS);
    assert.equal(centerQueryCount, 3, '1 SELECT đầu + 1 INSERT + 1 SELECT sau set (cache đã bị xóa)');
    assert.equal(after.get('pay_bank_code'), 'new', 'đọc sau set phải thấy giá trị mới');
  });
});
