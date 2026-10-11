/**
 * API layer cho feature Học phí (invoices + payments).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';
import type { InvoiceItem, PendingPayment, DebtRow, RemindResult } from '../../shared/types';

// ADM-18: dùng type chung ở shared/types (trước đây khai báo trùng ở đây và đã lệch nhau)
export type { InvoiceItem, PendingPayment, DebtRow, RemindResult };

export interface PaymentItem {
  id: number;
  invoice_id: number;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface InvoiceDetailData {
  invoice: InvoiceItem;
  payments: PaymentItem[];
}

export interface PaymentConfigData {
  pay_bank_code: string;
  pay_bank_account_no: string;
  pay_bank_account_name: string;
  pay_vnp_tmncode: string;
  pay_vnp_enabled: string;
  pay_vnp_hashsecret: string;
  referral_reward_referrer: string;
  referral_reward_referred: string;
}

const METHOD_I18N_KEY: Record<string, string> = {
  'Tiền mặt': 'cash',
  'Chuyển khoản': 'transfer',
  'Quẹt thẻ': 'card',
  'Ví điện tử': 'ewallet',
  refund: 'refund',
  credit: 'credit',
};

/** Hiển thị phương thức thanh toán: chuỗi legacy/mã hệ thống -> label i18n, chuỗi lạ (vnpay, QR...) giữ nguyên. */
export function paymentMethodLabel(method: string | null, t: (key: string) => string): string | null {
  if (!method) return null;
  const code = METHOD_I18N_KEY[method];
  return code ? t(`pay.methods.${code}`) : method;
}

export interface AvailableCredit {
  id: number;
  available: number;
  reason: string | null;
  parent_name: string;
}

export const invoicesApi = {
  list: (search = '', status = '', page?: PageParams) => {
    const q = new URLSearchParams({ search, status });
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    return http.get<Paginated<InvoiceItem>>(`/invoices?${q}`);
  },
  listDebt: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<DebtRow>>(qs ? `/invoices/debt?${qs}` : '/invoices/debt');
  },
  getDebtSummary: () => http.get<{ totalDebt: number; debtorCount: number }>('/invoices/debt-summary'),
  create: (data: {
    student_id: number;
    class_id?: number | null;
    amount: number;
    due_date?: string | null;
    note?: string | null;
  }) => http.post<InvoiceItem>('/invoices', data),
  recordPayment: (
    invoiceId: number,
    data: { amount: number; method: string; note?: string | null },
    idempotencyKey?: string
  ) =>
    http.postIdempotent<{ ok: boolean; status: string }>(
      `/invoices/${invoiceId}/payments`,
      data,
      idempotencyKey
    ),
  refund: (invoiceId: number, data: { amount: number; reason?: string }, idempotencyKey?: string) =>
    http.postIdempotent<{ ok: boolean; refunded: number; status: string }>(
      `/invoices/${invoiceId}/refund`,
      data,
      idempotencyKey
    ),
  /** O-2: credits còn dùng được cho hóa đơn (phụ huynh của học viên, cùng trung tâm) */
  listCredits: (invoiceId: number) => http.get<AvailableCredit[]>(`/invoices/${invoiceId}/credits`),
  applyCredit: (invoiceId: number, creditId: number) =>
    http.post<{ ok: boolean; applied: number; status: string }>(`/invoices/${invoiceId}/apply-credit`, {
      credit_id: creditId,
    }),
  remind: (invoiceId: number, kind: 'overdue' | 'upcoming') =>
    http.post<RemindResult>(`/invoices/${invoiceId}/remind`, { kind }),
  detail: (invoiceId: number) => http.get<InvoiceDetailData>(`/invoices/${invoiceId}`),
};

export const paymentsApi = {
  listPending: (page?: PageParams) => {
    const q = new URLSearchParams();
    if (page?.page) q.set('page', String(page.page));
    if (page?.limit) q.set('limit', String(page.limit));
    const qs = q.toString();
    return http.get<Paginated<PendingPayment>>(qs ? `/payments/pending?${qs}` : '/payments/pending');
  },
  approve: (id: number) => http.post<{ ok: boolean; status: string }>(`/payments/pending/${id}/approve`),
  reject: (id: number) => http.post<{ ok: boolean }>(`/payments/pending/${id}/reject`),
  getConfig: () => http.get<PaymentConfigData>('/payments/config'),
  saveConfig: (form: Partial<PaymentConfigData>) => http.put<{ ok: boolean }>('/payments/config', form),
};
