/**
 * Unit test cho FIX chịu tải: công nợ tính "đã thu" bằng LEFT JOIN LATERAL theo từng hóa đơn
 * còn lại sau WHERE (PERF-2) — không gom GROUP BY cả bảng payments của mọi trung tâm.
 *
 * Không cần PostgreSQL thật: mock db.prepare để bắt SQL, kiểm tra
 * (1) SQL mới dùng LATERAL theo hóa đơn, không gom cả bảng payments,
 * (2) semantics/shape trả về giữ nguyên qua mock dữ liệu.
 */
// PHẢI đặt trước mọi import db — pg-compat đọc DATABASE_URL lúc load module.
// Pool chỉ kết nối khi có query thật; test này mock hết nên URL giả là đủ.
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test');

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/pg-compat';
import * as invoicesService from './invoices.service';

const origPrepare = db.prepare;
let captured: string[];
let mockGet: unknown;
let mockAll: unknown[];

function stmt() {
  return {
    get: async (..._args: unknown[]) => mockGet,
    all: async (..._args: unknown[]) => mockAll,
    run: async (..._args: unknown[]) => ({ lastInsertRowid: 0, changes: 0 }),
  };
}

beforeEach(() => {
  captured = [];
  mockGet = { c: 0 }; // mặc định cho query COUNT(*) của getDebtReport
  mockAll = [];
  (db as { prepare: unknown }).prepare = (sql: string) => {
    captured.push(sql);
    return stmt();
  };
});

after(() => {
  db.prepare = origPrepare;
});

const JOIN = invoicesService.confirmedPaidJoin;

describe('getDebtReport — LATERAL theo hóa đơn (PERF-2)', () => {
  it('SQL dùng LATERAL theo hóa đơn, không gom cả bảng payments', async () => {
    await invoicesService.getDebtReport(1, { page: 1, limit: 10 });
    const main = captured[captured.length - 1];
    assert.ok(main.includes(JOIN), 'thiếu LEFT JOIN LATERAL');
    assert.ok(!main.includes('GROUP BY invoice_id'), 'không được gom cả bảng payments');
    assert.ok(!main.includes('WHERE p.invoice_id = i.id'), 'vẫn còn correlated subquery trong câu chính');
    // JOIN phải đứng trước WHERE trong mệnh đề FROM
    assert.ok(main.indexOf('LEFT JOIN') < main.indexOf('WHERE'), 'LEFT JOIN phải đứng trước WHERE');
  });

  it('giữ nguyên shape: debt = total - paid, kèm invoice_dues', async () => {
    mockAll = [
      {
        id: 1,
        code: 'ST001',
        name: 'An',
        phone: '090',
        total: 2000000,
        paid: 500000,
        invoice_dues: '3:2026-10-01',
      },
    ];
    const report = await invoicesService.getDebtReport(1, { page: 1, limit: 10 });
    assert.equal(report.data.length, 1);
    const row = report.data[0] as { debt: number; invoice_dues: string };
    assert.equal(row.debt, 1500000);
    assert.equal(row.invoice_dues, '3:2026-10-01');
  });
});

describe('getDebtSummary — LATERAL theo hóa đơn (PERF-2)', () => {
  it('SQL dùng LATERAL theo hóa đơn, không gom cả bảng payments', async () => {
    await invoicesService.getDebtSummary(1);
    assert.equal(captured.length, 1);
    assert.ok(captured[0].includes(JOIN), 'thiếu LEFT JOIN LATERAL');
    assert.ok(!captured[0].includes('WHERE p.invoice_id = i.id'), 'vẫn còn correlated subquery');
    assert.ok(
      captured[0].indexOf('LEFT JOIN') < captured[0].lastIndexOf('WHERE i.status'),
      'LEFT JOIN phải đứng trước WHERE chính'
    );
  });

  it('giữ nguyên shape {totalDebt, debtorCount} và fallback 0 khi NULL', async () => {
    mockGet = { totalDebt: null, debtorCount: 0 };
    assert.deepEqual(await invoicesService.getDebtSummary(1), { totalDebt: 0, debtorCount: 0 });
    mockGet = { totalDebt: 750000, debtorCount: 2 };
    assert.deepEqual(await invoicesService.getDebtSummary(1), { totalDebt: 750000, debtorCount: 2 });
  });
});
