/**
 * API layer cho feature Học phí (invoices + payments).
 */
import { http, type Paginated, type PageParams } from '../../shared/api/client';

export interface InvoiceItem {
  id: number;
  student_id: number;
  student_name: string;
  student_code: string;
  class_id: number | null;
  class_name: string | null;
  amount: number;
  discount: number;
  status: 'unpaid' | 'partial' | 'paid';
  due_date: string | null;
  note: string | null;
  paid: number;
}

export interface PendingPayment {
  id: number;
  invoice_id: number;
  amount: number;
  paid_at: string;
  method: string;
  note: string | null;
  student_name: string;
  student_code: string;
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

export interface DebtRow {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  total: number;
  paid: number;
  debt: number;
  /** "id:due_date,id:due_date..." các hóa đơn chưa thanh toán đủ */
  invoice_dues?: string;
}

export interface RemindResult {
  demo?: boolean;
  status: string;
  message: string;
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
    discount?: number;
    due_date?: string | null;
    note?: string | null;
  }) => http.post<InvoiceItem>('/invoices', data),
  recordPayment: (invoiceId: number, data: { amount: number; method: string; note?: string | null }, idempotencyKey?: string) =>
    http.postIdempotent<{ ok: boolean; status: string }>(`/invoices/${invoiceId}/payments`, data, idempotencyKey),
  refund: (invoiceId: number, data: { amount: number; reason?: string }, idempotencyKey?: string) =>
    http.postIdempotent<{ ok: boolean; refunded: number; status: string }>(
      `/invoices/${invoiceId}/refund`,
      data,
      idempotencyKey
    ),
  applyCredit: (invoiceId: number, creditId: number) =>
    http.post<{ ok: boolean; applied: number; status: string }>(`/invoices/${invoiceId}/apply-credit`, {
      credit_id: creditId,
    }),
  remind: (invoiceId: number, kind: 'overdue' | 'upcoming') =>
    http.post<RemindResult>(`/invoices/${invoiceId}/remind`, { kind }),
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
