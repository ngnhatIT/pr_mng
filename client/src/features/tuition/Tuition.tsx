import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { invoicesApi, paymentsApi, InvoiceItem, PendingPayment, DebtRow } from './tuition.api';
import { studentsApi, Student } from '../students/students.api';
import { classesApi, ClassItem } from '../classes/classes.api';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { useDebounce } from '../../shared/hooks/useDebounce';
import { Icon } from '../../shared/components/icons';
import { formatVND, formatDate } from '../../shared/types';
import './Tuition.css';
import { ReceiptModal } from '../../shared/components/ReceiptModal';
import { EmptyCell } from '../../shared/components/EmptyCell';

export function remindKind(dueDate: string | null): 'overdue' | 'upcoming' {
  const today = new Date().toISOString().slice(0, 10);
  return dueDate && dueDate < today ? 'overdue' : 'upcoming';
}

export function Tuition() {
  const { t } = useTranslation(['tuition', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState(tabParam === 'debt' || tabParam === 'pending' ? tabParam : 'invoices');

  const switchTab = (t: 'invoices' | 'debt' | 'pending') => {
    setTab(t);
    setSearchParams(t === 'invoices' ? {} : { tab: t }, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title={t('title')} desc={t('desc')} />
      <div className="tabs">
        <button className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => switchTab('invoices')}>
          {t('invoices.tab')}
        </button>
        <button className={`tab${tab === 'debt' ? ' active' : ''}`} onClick={() => switchTab('debt')}>
          {t('debt.tab')}
        </button>
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => switchTab('pending')}>
          {t('pending.tab')}
        </button>
      </div>
      {tab === 'invoices' ? (
        <InvoiceList />
      ) : tab === 'debt' ? (
        <DebtList />
      ) : (
        <PendingPayments onViewInvoices={() => switchTab('invoices')} />
      )}
    </div>
  );
}

function PendingPayments({ onViewInvoices }: { onViewInvoices: () => void }) {
  const { t } = useTranslation(['tuition', 'common']);
  const [items, setItems] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await paymentsApi.listPending({ page });
      setItems(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toastApiError(toast, err, t('pending.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (p: PendingPayment, action: 'approve' | 'reject') => {
    setBusyId(p.id);
    try {
      if (action === 'approve') await paymentsApi.approve(p.id);
      else await paymentsApi.reject(p.id);
      toast(action === 'approve' ? t('pending.approved') : t('pending.rejected'), 'success');
      void load();
    } catch (err) {
      toastApiError(toast, err, t('pending.fail'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">{t('pending.note')}</span>
      </div>
      {loading && items.length === 0 ? (
        <TableSkeleton cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={t('pending.emptyTitle')}
          desc={t('pending.emptyDesc')}
          action={
            <button className="btn btn-secondary btn-inline" onClick={onViewInvoices}>
              {t('pending.viewInvoices')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('pending.table.student')}</th>
                <th scope="col">{t('pending.table.amount')}</th>
                <th scope="col">{t('pending.table.method')}</th>
                <th scope="col">{t('pending.table.reportedAt')}</th>
                <th scope="col">{t('pending.table.note')}</th>
                <th scope="col" className="th-right">
                  {t('pending.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.student_name} <span className="muted mono">({p.student_code})</span>
                  </td>
                  <td className="num">{formatVND(p.amount)}</td>
                  <td>{p.method || t('pending.defaultMethod')}</td>
                  <td>{formatDate(p.paid_at)}</td>
                  <td>{p.note || <EmptyCell />}</td>
                  <td className="td-right">
                    <span className="tuition-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => void moderate(p, 'approve')}
                        disabled={busyId === p.id}
                      >
                        {busyId === p.id && <span className="spinner" aria-hidden="true" />}
                        {t('pending.approve')}
                      </button>
                      <button
                        className="btn btn-sm btn-danger-ghost"
                        onClick={() => void moderate(p, 'reject')}
                        disabled={busyId === p.id}
                      >
                        {busyId === p.id && <span className="spinner spinner-dark" aria-hidden="true" />}
                        {t('pending.reject')}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}
    </>
  );
}

function InvoiceList() {
  const { t } = useTranslation(['tuition', 'common']);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [debtSummary, setDebtSummary] = useState<{ totalDebt: number; debtorCount: number } | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [paying, setPaying] = useState<InvoiceItem | null>(null);
  const [receipt, setReceipt] = useState<InvoiceItem | null>(null);
  const [crediting, setCrediting] = useState<InvoiceItem | null>(null);
  const [refunding, setRefunding] = useState<InvoiceItem | null>(null);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const remindInvoice = async (inv: InvoiceItem) => {
    setRemindingId(inv.id);
    try {
      const r = await invoicesApi.remind(inv.id, remindKind(inv.due_date));
      toast(
        r.demo ? t('invoice.remindDemo', { message: r.message }) : r.message,
        r.status === 'failed' ? 'error' : 'success'
      );
    } catch (err) {
      toastApiError(toast, err, t('invoice.remindError'));
    } finally {
      setRemindingId(null);
    }
  };

  const debouncedSearch = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoicesApi.list(debouncedSearch, status, { page });
      setInvoices(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toastApiError(toast, err, t('invoices.loadError'));
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalDebt = debtSummary?.totalDebt ?? invoices.reduce((s, i) => s + (i.amount - (i.paid || 0)), 0);

  useEffect(() => {
    invoicesApi
      .getDebtSummary()
      .then(setDebtSummary)
      .catch(() => {});
  }, []);

  const filteringInvoices = search.trim() !== '' || status !== '';

  return (
    <>
      <div className="toolbar tuition-toolbar">
        <span className={`search-wrap${search ? ' has-clear' : ''}`}>
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            aria-label={t('invoices.searchPlaceholder')}
            placeholder={t('invoices.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search !== '' &&
            (loading || search !== debouncedSearch ? (
              <span className="search-clear" aria-hidden="true">
                <span className="spinner spinner-dark" />
              </span>
            ) : (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                aria-label={t('invoices.clearSearch')}
              >
                <Icon name="x" size={14} />
              </button>
            ))}
        </span>
        <select
          aria-label={t('invoices.statusFilterLabel')}
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('searchAllStatuses')}</option>
          <option value="unpaid">{t('invoiceStatus.unpaid')}</option>
          <option value="partial">{t('invoiceStatus.partial')}</option>
          <option value="paid">{t('invoiceStatus.paid')}</option>
        </select>
        <span className="spacer" />
        <span className="debt-pill" aria-live="polite" title={t('invoices.debtStripTitle')}>
          <Icon name="alert" size={14} />
          {debtSummary ? (
            t('invoices.debtStrip', {
              count: debtSummary.debtorCount,
              total: formatVND(debtSummary.totalDebt),
            })
          ) : (
            <>
              {t('invoices.totalDebt')} <strong className="debt-amount">{formatVND(totalDebt)}</strong>
            </>
          )}
        </span>
        <button className="btn btn-primary btn-inline" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={14} />
          {t('invoice.create')}
        </button>
      </div>

      {loading && invoices.length === 0 ? (
        <TableSkeleton cols={8} />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon="banknote"
          title={t(filteringInvoices ? 'invoices.emptyFiltered.title' : 'invoices.emptyTitle')}
          desc={t(filteringInvoices ? 'invoices.emptyFiltered.desc' : 'invoices.emptyDesc')}
          action={
            filteringInvoices ? (
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                  setPage(1);
                }}
              >
                <Icon name="x" size={14} />
                {t('invoices.emptyFiltered.clear')}
              </button>
            ) : (
              <button className="btn btn-primary btn-inline" onClick={() => setShowCreate(true)}>
                <Icon name="plus" size={14} />
                {t('invoice.create')}
              </button>
            )
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('invoice.table.student')}</th>
                <th scope="col">{t('invoice.table.class')}</th>
                <th scope="col" className="th-right">
                  {t('invoice.table.amount')}
                </th>
                <th scope="col" className="th-right">
                  {t('invoice.table.paid')}
                </th>
                <th scope="col" className="th-right">
                  {t('invoice.table.debt')}
                </th>
                <th scope="col">{t('invoice.table.dueDate')}</th>
                <th scope="col">{t('invoice.table.status')}</th>
                <th scope="col" className="th-right">
                  {t('invoice.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const paid = inv.paid || 0;
                return (
                  <tr key={inv.id}>
                    <td>
                      {inv.student_name} <span className="muted mono">({inv.student_code})</span>
                    </td>
                    <td>{inv.class_name || <EmptyCell />}</td>
                    <td className="num">{formatVND(inv.amount)}</td>
                    <td className="num">{formatVND(paid)}</td>
                    <td className="num debt-amount">{formatVND(inv.amount - paid)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>
                      <span className={`badge badge-${inv.status}`}>{t(`invoiceStatus.${inv.status}`)}</span>
                    </td>
                    <td className="td-right nowrap">
                      <span className="tuition-actions">
                        {inv.status !== 'paid' && (
                          <>
                            <button
                              className="btn btn-sm"
                              onClick={() => void remindInvoice(inv)}
                              disabled={remindingId === inv.id}
                              title={t('invoice.remindTitle')}
                            >
                              {remindingId === inv.id && (
                                <span className="spinner spinner-dark" aria-hidden="true" />
                              )}
                              {remindingId === inv.id ? t('invoice.sending') : t('invoice.remindZalo')}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => setCrediting(inv)}
                              title={t('credit.applyTitle')}
                            >
                              {t('credit.apply')}
                            </button>
                            <button className="btn btn-sm btn-primary" onClick={() => setPaying(inv)}>
                              {t('pay.collect')}
                            </button>
                          </>
                        )}
                        {paid > 0 && (
                          <button
                            className="btn btn-sm btn-danger-ghost"
                            onClick={() => setRefunding(inv)}
                            title={t('refund.title')}
                          >
                            <Icon name="rotate" size={14} />
                            {t('refund.action')}
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setReceipt(inv)}
                          title={t('receipt.title')}
                        >
                          <Icon name="printer" size={14} />
                          {t('receipt.print')}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}

      {showCreate && (
        <InvoiceFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            void load();
          }}
        />
      )}
      {receipt && (
        <ReceiptModal
          invoice={receipt}
          centerName={t('receipt.defaultCenter')}
          onClose={() => setReceipt(null)}
        />
      )}
      {refunding && (
        <RefundModal
          invoice={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            void load();
          }}
        />
      )}
      {crediting && (
        <ApplyCreditModal
          invoice={crediting}
          onClose={() => setCrediting(null)}
          onDone={() => {
            setCrediting(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function ApplyCreditModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['tuition', 'common']);
  const [creditId, setCreditId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const remain = invoice.amount - (invoice.paid || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditId.trim()) {
      toast(t('credit.idRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await invoicesApi.applyCredit(invoice.id, Number(creditId));
      toast(t('credit.applied', { amount: formatVND(r.applied) }), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('credit.applyError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('credit.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="confirm-text">
          <Trans
            i18nKey="credit.confirmText"
            ns="tuition"
            values={{
              name: invoice.student_name,
              code: invoice.student_code,
              amount: formatVND(remain),
            }}
            components={{ strong: <strong className="debt-amount" /> }}
          />
        </p>
        <p className="muted">
          <Trans i18nKey="credit.help" ns="tuition" components={{ strong: <strong /> }} />
        </p>
        <Field label={t('credit.idLabel')}>
          <input
            className="text-input"
            type="number"
            min={1}
            value={creditId}
            onChange={(e) => setCreditId(e.target.value)}
            placeholder={t('credit.idPlaceholder')}
            required
          />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('credit.applying') : t('credit.apply')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['tuition', 'common']);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Focus vào field lỗi đầu tiên sau submit (skill 8.2)
  const studentRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      studentsApi.list('', 'studying', { limit: 100 }),
      classesApi.list("", { limit: 100 }).then((r) => r.data),
    ])
      .then(([s, c]) => {
        setStudents(s.data);
        setClasses(c);
      })
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  // Auto-fill tuition fee when a class is picked
  const pickClass = (cid: string) => {
    setClassId(cid);
    const c = classes.find((x) => String(x.id) === cid);
    if (c) setAmount(String(c.tuition_fee));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!studentId) errs.studentId = t('invoiceForm.studentRequired');
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      errs.amount = t('invoiceForm.amountInvalid');
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Focus field lỗi đầu tiên (theo thứ tự hiển thị trên form)
      if (errs.studentId) studentRef.current?.focus();
      else if (errs.amount) amountRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await invoicesApi.create({
        student_id: Number(studentId),
        class_id: classId ? Number(classId) : null,
        amount: Number(amount),
        due_date: dueDate || null,
        note: note || null,
      });
      toast(t('invoiceForm.created'), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('invoiceForm.createError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('invoiceForm.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('invoiceForm.student')} span error={fieldErrors.studentId} required>
            <select
              ref={studentRef}
              className="text-input"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            >
              <option value="">{t('invoiceForm.selectStudent')}</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('invoiceForm.class')} span>
            <select className="text-input" value={classId} onChange={(e) => pickClass(e.target.value)}>
              <option value="">{t('invoiceForm.noClass')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {t('invoiceForm.classOption', { name: c.name, fee: formatVND(c.tuition_fee) })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('invoiceForm.amount')} error={fieldErrors.amount} required>
            <input
              ref={amountRef}
              className="text-input"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label={t('invoiceForm.dueDate')}>
            <input
              className="text-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label={t('invoiceForm.note')} span>
            <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('invoiceForm.creating') : t('invoiceForm.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Phương thức thanh toán: state giữ `code` để hiển thị qua i18n, khi gửi server
 * map về chuỗi tiếng Việt cũ (server nhận chuỗi tự do, DB đang lưu các giá trị này).
 */
const PAYMENT_METHODS = [
  { code: 'cash', legacy: 'Tiền mặt' },
  { code: 'transfer', legacy: 'Chuyển khoản' },
  { code: 'card', legacy: 'Quẹt thẻ' },
  { code: 'ewallet', legacy: 'Ví điện tử' },
] as const;

type PaymentMethodCode = (typeof PAYMENT_METHODS)[number]['code'];

function PayModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['tuition', 'common']);
  const paid = invoice.paid || 0;
  const remain = invoice.amount - paid;
  const [amount, setAmount] = useState(String(remain));
  const [method, setMethod] = useState<PaymentMethodCode>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'amount'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // Chống double-submit khi Enter nhanh 2 lần
    const amt = Number(amount);
    const errs: { amount?: string } = {};
    if (!amount.trim()) errs.amount = t('pay.errors.amountRequired');
    else if (!Number.isFinite(amt) || amt < 1 || amt > remain) errs.amount = t('pay.errors.amountInvalid');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await invoicesApi.recordPayment(invoice.id, {
        amount: Number(amount),
        // Giữ tương thích server/DB: gửi chuỗi tiếng Việt cũ thay vì code
        method: PAYMENT_METHODS.find((m) => m.code === method)?.legacy ?? method,
        note: note || null,
      });
      toast(t('pay.recorded'), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('pay.payError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('pay.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="confirm-text">
          <Trans
            i18nKey="pay.confirmText"
            ns="tuition"
            values={{ name: invoice.student_name, debt: formatVND(remain) }}
            components={{ strong: <strong className="debt-amount" /> }}
          />
        </p>
        <div className="form-grid">
          <Field label={t('pay.amount')} error={errors.amount}>
            <input
              ref={refFor('amount')}
              className="text-input"
              type="number"
              min={1}
              max={remain}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clear('amount');
              }}
            />
          </Field>
          <Field label={t('pay.method')}>
            <select
              className="text-input"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethodCode)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.code} value={m.code}>
                  {t(`pay.methods.${m.code}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('pay.note')} span>
            <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('pay.collecting') : t('pay.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RefundModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['tuition', 'common']);
  const paid = invoice.paid || 0;
  const [amount, setAmount] = useState(String(paid));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'amount'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // Chống double-submit
    const amt = Number(amount);
    const errs: { amount?: string } = {};
    if (!amount.trim() || !Number.isFinite(amt) || amt < 1 || amt > paid)
      errs.amount = t('refund.errors.amountInvalid');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await invoicesApi.refund(invoice.id, {
        amount: Number(amount),
        reason: reason || undefined,
      });
      toast(t('refund.done'), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('refund.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('refund.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="confirm-text">
          <Trans
            i18nKey="refund.confirmText"
            ns="tuition"
            values={{ name: invoice.student_name, paid: formatVND(paid) }}
            components={{ strong: <strong className="debt-amount" /> }}
          />
        </p>
        <div className="form-grid">
          <Field label={t('refund.amount')} error={errors.amount}>
            <input
              ref={refFor('amount')}
              className="text-input"
              type="number"
              min={1}
              max={paid}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clear('amount');
              }}
            />
          </Field>
          <Field label={t('refund.reason')} span>
            <input
              className="text-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('refund.reasonPlaceholder')}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('refund.processing') : t('refund.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DebtList() {
  const { t } = useTranslation(['tuition', 'common']);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const loadDebts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await invoicesApi.listDebt({ page });
      setDebts(r.data);
      setPagination(r.pagination);
    } catch (err) {
      toastApiError(toast, err, t('debt.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts]);

  const total = debts.reduce((s, d) => s + d.debt, 0);

  /** Nhắc Zalo tất cả hóa đơn chưa thanh toán đủ của một học viên */
  const remindStudent = async (d: DebtRow) => {
    const dues = (d.invoice_dues || '')
      .split(',')
      .filter(Boolean)
      .map((part) => {
        const [id, due] = part.split(':');
        return { id: Number(id), due: due || null };
      })
      .filter((x) => !Number.isNaN(x.id));
    if (dues.length === 0) {
      toast(t('debt.noInvoices'), 'error');
      return;
    }
    setRemindingId(d.id);
    let sent = 0;
    let demo = 0;
    let failed = 0;
    try {
      for (const inv of dues) {
        try {
          const r = await invoicesApi.remind(inv.id, remindKind(inv.due));
          if (r.demo) demo++;
          else if (r.status === 'sent') sent++;
          else failed++;
        } catch {
          failed++;
        }
      }
      toast(t('debt.remindResult', { name: d.name, sent, demo, failed }), failed > 0 ? 'error' : 'success');
    } finally {
      setRemindingId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">
          <Trans
            i18nKey="debt.summary"
            ns="tuition"
            values={{ count: debts.length, total: formatVND(total) }}
            components={{ strong: <strong className="debt-amount" /> }}
          />
        </span>
      </div>
      {loading && debts.length === 0 ? (
        <TableSkeleton cols={6} />
      ) : debts.length === 0 ? (
        <EmptyState icon="check-circle" title={t('debt.emptyTitle')} desc={t('debt.emptyDesc')} />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('debt.table.student')}</th>
                <th scope="col">{t('debt.table.phone')}</th>
                <th scope="col" className="th-right">
                  {t('debt.table.total')}
                </th>
                <th scope="col" className="th-right">
                  {t('debt.table.paid')}
                </th>
                <th scope="col" className="th-right">
                  {t('debt.table.debt')}
                </th>
                <th scope="col" className="th-right">
                  {t('debt.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.name} <span className="muted mono">({d.code})</span>
                  </td>
                  <td>{d.phone || <EmptyCell />}</td>
                  <td className="num">{formatVND(d.total)}</td>
                  <td className="num">{formatVND(d.paid)}</td>
                  <td className="num debt-amount">{formatVND(d.debt)}</td>
                  <td className="td-right">
                    <button
                      className="btn btn-sm"
                      onClick={() => void remindStudent(d)}
                      disabled={remindingId === d.id}
                      title={t('debt.remindTitle')}
                    >
                      {remindingId === d.id ? t('debt.sending') : t('debt.remindZalo')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}
    </>
  );
}
