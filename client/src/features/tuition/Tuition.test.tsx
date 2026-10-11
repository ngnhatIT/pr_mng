// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import {
  $,
  $$,
  byText,
  cleanup,
  click,
  json,
  mockFetch,
  renderRoutes,
  type,
  type Call,
} from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { Tuition } from './Tuition';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'tuition', ...o }));
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 },
});
const inv = (id: number, status: string, amount: number, paid: number) => ({
  id,
  student_id: id,
  class_id: 1,
  amount,
  paid,
  status,
  due_date: '2026-10-01',
  note: null,
  created_at: '2026-09-01',
  student_name: `HV ${id}`,
  student_code: `S${id}`,
  class_name: 'A1',
});

let n = 0;
/** Mỗi test 1 token mới: cache quyền (loadMyPermissions) theo token. */
function login(perms: string[]) {
  setAuth(`tok${++n}`, { id: 1, username: 'a', role: 'admin', name: 'A' });
  return { 'GET /roles/me/permissions': perms.map((code) => ({ code })) };
}
const get = (calls: Call[], path: string) => calls.filter((c) => c.method === 'GET' && c.path === path);
const render = (at = '/app/tuition') => renderRoutes([{ path: '/app/tuition', element: <Tuition /> }], at);

afterEach(cleanup);

describe('Tuition: danh sách hóa đơn', () => {
  it('hiện dòng + tổng nợ từ server; lọc trạng thái -> gọi lại API và ghi lên URL', async () => {
    const calls = mockFetch({
      ...login([]),
      'GET /invoices': (c: Call) =>
        page(
          c.query.get('status') === 'paid'
            ? []
            : [inv(1, 'unpaid', 1_500_000, 0), inv(2, 'partial', 1_000_000, 400_000)]
        ),
      'GET /invoices/debt-summary': { totalDebt: 2_100_000, debtorCount: 2 },
    });
    const router = await render();
    expect($$('tbody tr')).toHaveLength(2);
    expect($('.debt-pill')!.textContent).toMatch(/2\.100\.000/);
    expect($$('tbody tr')[1].querySelector('.debt-amount')!.textContent).toMatch(/600\.000/);
    // Không có quyền -> không hiện nút thu / tạo hóa đơn
    expect($$('button').some((b) => b.textContent === t('pay.collect'))).toBe(false);

    await type($('select[aria-label]'), 'paid');
    expect(get(calls, '/invoices').at(-1)!.query.get('status')).toBe('paid');
    expect(router.state.location.search).toContain('status=paid');
    expect(document.body.textContent).toContain(t('invoices.emptyFiltered.title'));
  });

  it('lỗi tải -> LoadError có nút thử lại (không hiện "chưa có hóa đơn")', async () => {
    let fail = true;
    mockFetch({
      ...login([]),
      'GET /invoices': () =>
        fail ? json(500, { error: 'x', code: 'INTERNAL_ERROR' }) : page([inv(1, 'unpaid', 100, 0)]),
      'GET /invoices/debt-summary': { totalDebt: 0, debtorCount: 0 },
    });
    await render();
    expect(document.body.textContent).not.toContain(t('invoices.emptyTitle'));
    fail = false;
    await click(byText(String(i18n.t('actions.retry', { ns: 'common' }))));
    expect($$('tbody tr')).toHaveLength(1);
  });

  it('thu tiền: chặn số tiền > còn nợ; hợp lệ -> POST payments kèm Idempotency-Key, tải lại list + tổng nợ', async () => {
    const calls = mockFetch({
      ...login(['payments.collect']),
      'GET /invoices': page([inv(3, 'partial', 1_000_000, 400_000)]),
      'GET /invoices/debt-summary': { totalDebt: 600_000, debtorCount: 1 },
      'POST /invoices/3/payments': { ok: true, status: 'paid' },
    });
    await render();
    await click(byText(t('pay.collect')));
    const amount = $<HTMLInputElement>('[role="dialog"] input')!;
    await type(amount, '700000');
    await click($('[role="dialog"] button[type="submit"]'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect($('[role="dialog"]')!.textContent).toContain(t('pay.errors.amountInvalid'));

    await type(amount, '600000');
    await type($('[role="dialog"] select'), 'transfer');
    await click($('[role="dialog"] button[type="submit"]'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/invoices/3/payments');
    expect(post.body).toEqual({ amount: 600000, method: 'Chuyển khoản', note: null });
    expect(post.headers['Idempotency-Key']).toMatch(/^pay-3-/);
    expect($('[role="dialog"]')).toBeNull();
    expect(get(calls, '/invoices')).toHaveLength(2);
    expect(get(calls, '/invoices/debt-summary')).toHaveLength(2);
  });
});

describe('Tuition: tab công nợ + chờ duyệt', () => {
  it('?tab=debt: nhắc Zalo lần lượt từng hóa đơn còn nợ, đếm kết quả', async () => {
    const calls = mockFetch({
      ...login(['notifications.send']),
      'GET /invoices/debt': page([
        {
          id: 5,
          code: 'S5',
          name: 'An',
          phone: null,
          total: 2e6,
          paid: 0,
          debt: 2e6,
          invoice_dues: '11:2020-01-01,12:2999-01-01',
        },
      ]),
      'GET /invoices/debt-summary': { totalDebt: 2e6, debtorCount: 1 },
      'POST /invoices/11/remind': { demo: false, status: 'sent' },
      'POST /invoices/12/remind': json(500, { error: 'x' }),
    });
    await render('/app/tuition?tab=debt');
    expect($('[role="tab"][aria-selected="true"]')!.textContent).toBe(t('debt.tab'));
    await click(byText(t('debt.remindZalo')));
    const reminds = calls.filter((c) => c.method === 'POST');
    expect(reminds.map((c) => [c.path, (c.body as { kind: string }).kind])).toEqual([
      ['/invoices/11/remind', 'overdue'],
      ['/invoices/12/remind', 'upcoming'],
    ]);
    expect($('.toast-error')!.textContent).toBe(
      t('debt.remindResult', { name: 'An', sent: 1, demo: 0, failed: 1 })
    );
  });

  it('?tab=pending: duyệt giao dịch -> POST approve rồi tải lại', async () => {
    const calls = mockFetch({
      ...login(['payments.approve']),
      'GET /payments/pending': page([
        {
          id: 8,
          invoice_id: 3,
          amount: 500000,
          paid_at: '2026-10-01',
          method: 'QR',
          note: null,
          student_name: 'An',
          student_code: 'S1',
        },
      ]),
      'POST /payments/pending/8/approve': { ok: true, status: 'paid' },
    });
    await render('/app/tuition?tab=pending');
    await click(byText(t('pending.approve')));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/payments/pending/8/approve')).toBe(true);
    expect(get(calls, '/payments/pending')).toHaveLength(2);
    expect(document.body.textContent).toContain(t('pending.approved'));
  });
});
