import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, collectAll, MAX_EXPORT_ROWS } from './csv';
import { paginate } from './pagination';

describe('toCsv()', () => {
  const cols = [
    { header: 'Tên', value: (r: { a: unknown }) => r.a },
    { header: 'Số', value: () => 1 },
  ];

  it('escape dấu phẩy, nháy kép, xuống dòng; null -> rỗng', () => {
    const csv = toCsv(cols, [{ a: 'a,b' }, { a: 'say "hi"' }, { a: 'x\ny' }, { a: null }]);
    assert.equal(csv, 'Tên,Số\r\n"a,b",1\r\n"say ""hi""",1\r\n"x\ny",1\r\n,1');
  });

  it('chặn formula injection ở chuỗi, giữ số âm', () => {
    const csv = toCsv(
      [{ header: 'v', value: (r: { v: unknown }) => r.v }],
      [{ v: '=HYPERLINK("x")' }, { v: '@SUM(A1)' }, { v: -5 }]
    );
    assert.equal(csv, 'v\r\n"\'=HYPERLINK(""x"")"\r\n\'@SUM(A1)\r\n-5');
  });
});

describe('collectAll()', () => {
  it('gom đủ mọi trang', async () => {
    const all = Array.from({ length: 250 }, (_, i) => i);
    const rows = await collectAll(async (page) =>
      paginate(all.slice((page - 1) * 100, page * 100), all.length, page, 100)
    );
    assert.deepEqual(rows, all);
  });

  it('dừng ở MAX_EXPORT_ROWS', async () => {
    let calls = 0;
    const rows = await collectAll(async (page) => {
      calls++;
      return paginate(Array(100).fill(page), 10 ** 6, page, 100);
    });
    assert.equal(rows.length, MAX_EXPORT_ROWS);
    assert.equal(calls, MAX_EXPORT_ROWS / 100);
  });
});
