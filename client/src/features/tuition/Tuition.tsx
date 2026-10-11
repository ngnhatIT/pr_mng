import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import {
  invoicesApi,
  paymentsApi,
  paymentMethodLabel,
  InvoiceItem,
  PendingPayment,
  DebtRow,
  type BulkInvoiceResult,
} from './tuition.api';
import { useStudentSearch, type Student } from '../students/students.api';
import { classesApi, ClassItem } from '../classes/classes.api';
import { useMyPermissions } from '../system/roles.api';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, MoneyInput, moneyDigits, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { ExportButton } from '../../shared/components/ExportButton';
import { SortHeader } from '../../shared/components/SortHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import {
  Pagination,
  clampPage,
  fetchAllPages,
  type PaginationMeta,
} from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlSearch, useUrlState } from '../../shared/hooks/useUrlState';
import { Menu } from '../../shared/components/Menu';
import { Icon } from '../../shared/components/icons';
import { formatVND, formatDate, remainingOf, todayVN } from '../../shared/types';
import './Tuition.css';
import { ReceiptModal } from '../../shared/components/ReceiptModal';
import { EmptyCell } from '../../shared/components/EmptyCell';
import { getUser } from '../../shared/api/client';
import { Tabs, tabPanelProps } from '../../shared/components/Tabs';

/** ADM-15: so với ngày hôm nay theo giờ VN (không phải UTC) để 0:00-7:00 không chọn nhầm mẫu 'upcoming'. */
export function remindKind(dueDate: string | null, today = todayVN()): 'overdue' | 'upcoming' {
  return dueDate && dueDate < today ? 'overdue' : 'upcoming';
}

type TabKey = 'invoices' | 'debt' | 'pending';

export function Tuition() {
  const { t } = useTranslation(['tuition', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  // B-3: tab suy ra từ URL (không useState) -> bấm sidebar /app/tuition khi đang ?tab=debt thì về đúng tab
  const tabParam = searchParams.get('tab');
  const tab: TabKey = tabParam === 'debt' || tabParam === 'pending' ? tabParam : 'invoices';

  const switchTab = (t: TabKey) => {
    setSearchParams(t === 'invoices' ? {} : { tab: t }, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title={t('title')} desc={t('desc')} />
      <Tabs
        id="tuition"
        label={t('title')}
        tabs={(['invoices', 'debt', 'pending'] as const).map((k) => ({ key: k, label: t(`${k}.tab`) }))}
        value={tab}
        onChange={switchTab}
      />
      <div {...tabPanelProps('tuition', tab)}>
        {tab === 'invoices' ? (
          <InvoiceList />
        ) : tab === 'debt' ? (
          <DebtList />
        ) : (
          <PendingPayments onViewInvoices={() => switchTab('invoices')} />
        )}
      </div>
    </div>
  );
}

function PendingPayments({ onViewInvoices }: { onViewInvoices: () => void }) {
  const { t } = useTranslation(['tuition', 'common']);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const toast = useToast();
  const canApprove = useMyPermissions().has('payments.approve');

  const { data: res, loading, error, reload } = useLoad(() => paymentsApi.listPending({ page }), [page]);
  const items = res?.data ?? [];
  useLoadErrorToast(error, t('pending.loadError'));
  // ADM-13: duyệt dòng cuối của trang cuối -> lùi về trang hợp lệ thay vì hiện "trống"
  useClampPage(res, page, setQ);

  const moderate = async (p: PendingPayment, action: 'approve' | 'reject') => {
    setBusyId(p.id);
    try {
      if (action === 'approve') await paymentsApi.approve(p.id);
      else await paymentsApi.reject(p.id);
      toast(action === 'approve' ? t('pending.approved') : t('pending.rejected'), 'success');
      reload();
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
      {loading && !res ? (
        <TableSkeleton cols={6} />
      ) : error && !res ? (
        <LoadError onRetry={reload} />
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
          <table className="table table-stack">
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
                  <td data-label={t('pending.table.amount')} className="num">
                    {formatVND(p.amount)}
                  </td>
                  <td data-label={t('pending.table.method')}>
                    {paymentMethodLabel(p.method, (k) => t(k)) || t('pending.defaultMethod')}
                  </td>
                  <td data-label={t('pending.table.reportedAt')}>{formatDate(p.paid_at)}</td>
                  <td data-label={t('pending.table.note')}>{p.note || <EmptyCell />}</td>
                  <td className="td-right">
                    {canApprove && (
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
                          {busyId === p.id && <span className="spinner" aria-hidden="true" />}
                          {t('pending.reject')}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && (
        <Pagination
          pagination={res.pagination}
          onChange={(p) => setQ({ page: String(p) })}
          loading={loading}
        />
      )}
    </>
  );
}

function InvoiceList() {
  const { t } = useTranslation(['tuition', 'common']);
  const [q, setQ] = useUrlState({ search: '', status: '', page: '1', sort: '' });
  const setSort = (sort: string) => setQ({ sort, page: '1' });
  const { status } = q;
  // B-2: chữ đang gõ ở state cục bộ, URL nhận giá trị đã debounce
  const [search, setSearch] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }));
  const page = Number(q.page) || 1;
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [paying, setPaying] = useState<InvoiceItem | null>(null);
  const [receipt, setReceipt] = useState<InvoiceItem | null>(null);
  const [crediting, setCrediting] = useState<InvoiceItem | null>(null);
  const [refunding, setRefunding] = useState<InvoiceItem | null>(null);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const toast = useToast();
  const perms = useMyPermissions();

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

  const debouncedSearch = q.search;

  const {
    data: res,
    loading,
    error,
    reload,
  } = useLoad(
    () => invoicesApi.list(debouncedSearch, status, { page }, q.sort),
    [debouncedSearch, status, page, q.sort]
  );
  const invoices = res?.data ?? [];
  const today = todayVN();
  useLoadErrorToast(error, t('invoices.loadError'));
  useClampPage(res, page, setQ);

  // UX-8: tổng nợ toàn trung tâm lấy từ server (/debt-summary); chưa có/lỗi thì hiện "—",
  // không cộng tạm các dòng trang hiện tại (đã lọc + chỉ 20 dòng) rồi gắn nhãn "tổng".
  const { data: debtSummary, reload: reloadSummary } = useLoad(() => invoicesApi.getDebtSummary(), []);

  // ADM-8: sau khi tạo hóa đơn/thu/hoàn/áp credit thì tải lại cả danh sách lẫn tổng nợ
  const reloadAll = () => {
    reload();
    reloadSummary();
  };

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
            onChange={(e) => setSearch(e.target.value)}
          />
          {search !== '' &&
            (loading || search !== debouncedSearch ? (
              <span className="search-clear" aria-hidden="true">
                <span className="spinner" />
              </span>
            ) : (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch('')}
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
          onChange={(e) => setQ({ status: e.target.value, page: '1' })}
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
              {t('invoices.totalDebt')} <strong className="debt-amount">—</strong>
            </>
          )}
        </span>
        <ExportButton kind="invoices" query={{ search: debouncedSearch, status }} />
        {perms.has('invoices.create') && (
          <button className="btn btn-inline" onClick={() => setShowBulk(true)}>
            <Icon name="calendar" size={14} />
            {t('bulk.open')}
          </button>
        )}
        {perms.has('invoices.create') && (
          <button className="btn btn-primary btn-inline" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={14} />
            {t('invoice.create')}
          </button>
        )}
      </div>

      {loading && !res ? (
        <TableSkeleton cols={8} />
      ) : error && !res ? (
        <LoadError onRetry={reload} />
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
                  setQ({ search: '', status: '', page: '1' });
                }}
              >
                <Icon name="x" size={14} />
                {t('invoices.emptyFiltered.clear')}
              </button>
            ) : (
              perms.has('invoices.create') && (
                <button className="btn btn-primary btn-inline" onClick={() => setShowCreate(true)}>
                  <Icon name="plus" size={14} />
                  {t('invoice.create')}
                </button>
              )
            )
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table table-stack">
            <thead>
              <tr>
                <SortHeader
                  label={t('invoice.table.student')}
                  field="student"
                  sort={q.sort}
                  onSort={setSort}
                />
                <th scope="col">{t('invoice.table.class')}</th>
                <SortHeader
                  label={t('invoice.table.amount')}
                  field="amount"
                  sort={q.sort}
                  onSort={setSort}
                  className="th-right"
                />
                <th scope="col" className="th-right">
                  {t('invoice.table.paid')}
                </th>
                <th scope="col" className="th-right">
                  {t('invoice.table.debt')}
                </th>
                <SortHeader
                  label={t('invoice.table.dueDate')}
                  field="due_date"
                  sort={q.sort}
                  onSort={setSort}
                />
                <SortHeader label={t('invoice.table.status')} field="status" sort={q.sort} onSort={setSort} />
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
                      <Link className="link" to={`/app/tuition/invoices/${inv.id}`}>
                        {inv.student_name}
                      </Link>
                      <div className="cell-sub mono">
                        HD{inv.id} · {inv.student_code}
                      </div>
                    </td>
                    <td data-label={t('invoice.table.class')}>{inv.class_name || <EmptyCell />}</td>
                    <td data-label={t('invoice.table.amount')} className="num">
                      {formatVND(inv.amount)}
                    </td>
                    <td data-label={t('invoice.table.paid')} className="num">
                      {formatVND(paid)}
                    </td>
                    <td data-label={t('invoice.table.debt')} className="num debt-amount">
                      {remainingOf(inv) > 0 ? formatVND(remainingOf(inv)) : <EmptyCell />}
                    </td>
                    <td
                      data-label={t('invoice.table.dueDate')}
                      className={
                        inv.status !== 'paid' && inv.due_date && inv.due_date < today
                          ? 'text-danger'
                          : undefined
                      }
                    >
                      {formatDate(inv.due_date)}
                    </td>
                    <td data-label={t('invoice.table.status')}>
                      <span className={`badge badge-${inv.status}`}>{t(`invoiceStatus.${inv.status}`)}</span>
                    </td>
                    <td className="td-right nowrap">
                      <span className="tuition-actions">
                        {inv.status !== 'paid' && perms.has('payments.collect') ? (
                          <button className="btn btn-sm btn-primary" onClick={() => setPaying(inv)}>
                            {t('pay.collect')}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-icon"
                            onClick={() => setReceipt(inv)}
                            aria-label={t('receipt.print')}
                            title={t('receipt.print')}
                          >
                            <Icon name="printer" size={15} />
                          </button>
                        )}
                        <Menu
                          label={t('actions.more', { ns: 'common' })}
                          items={[
                            ...(inv.status !== 'paid' && perms.has('notifications.send')
                              ? [
                                  {
                                    label:
                                      remindingId === inv.id ? t('invoice.sending') : t('invoice.remindZalo'),
                                    icon: 'send' as const,
                                    disabled: remindingId === inv.id,
                                    onSelect: () => void remindInvoice(inv),
                                  },
                                ]
                              : []),
                            ...(inv.status !== 'paid' && perms.has('payments.collect')
                              ? [
                                  {
                                    label: t('credit.applyRow'),
                                    icon: 'wallet' as const,
                                    onSelect: () => setCrediting(inv),
                                  },
                                ]
                              : []),
                            ...(inv.status !== 'paid' && perms.has('payments.collect')
                              ? [
                                  {
                                    label: t('receipt.print'),
                                    icon: 'printer' as const,
                                    onSelect: () => setReceipt(inv),
                                  },
                                ]
                              : []),
                            ...(paid > 0 && perms.has('payments.refund')
                              ? [
                                  {
                                    label: t('refund.action'),
                                    icon: 'rotate' as const,
                                    danger: true,
                                    onSelect: () => setRefunding(inv),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {res && (
        <Pagination
          pagination={res.pagination}
          onChange={(p) => setQ({ page: String(p) })}
          loading={loading}
        />
      )}

      {showBulk && (
        <BulkInvoiceModal
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false);
            reloadAll();
          }}
        />
      )}
      {showCreate && (
        <InvoiceFormModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            reloadAll();
          }}
        />
      )}
      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            reloadAll();
          }}
        />
      )}
      {receipt && (
        <ReceiptModal
          invoice={receipt}
          centerName={getUser()?.center_name || t('receipt.defaultCenter')}
          onClose={() => setReceipt(null)}
        />
      )}
      {refunding && (
        <RefundModal
          invoice={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            reloadAll();
          }}
        />
      )}
      {crediting && (
        <ApplyCreditModal
          invoice={crediting}
          onClose={() => setCrediting(null)}
          onDone={() => {
            setCrediting(null);
            reloadAll();
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
  // O-2: chọn từ danh sách credits khả dụng (server lọc đúng phụ huynh/trung tâm) thay vì nhập ID tay
  const {
    data: credits,
    loading,
    error,
    reload,
  } = useLoad(() => invoicesApi.listCredits(invoice.id), [invoice.id]);
  const [creditId, setCreditId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const remain = remainingOf(invoice);
  const selected = creditId || (credits?.length === 1 ? String(credits[0].id) : '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!selected) {
      toast(t('credit.idRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await invoicesApi.applyCredit(invoice.id, Number(selected));
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
        {loading && !credits ? (
          <TableSkeleton rows={2} cols={1} />
        ) : error && !credits ? (
          <LoadError onRetry={reload} />
        ) : !credits?.length ? (
          <p className="muted">{t('credit.none')}</p>
        ) : (
          <>
            <p className="muted">{t('credit.help')}</p>
            <Field label={t('credit.idLabel')} required>
              <select
                // B3-4: select mount sau khi tải xong -> autoFocus để focus không nằm ở nút Hủy
                autoFocus
                className="text-input"
                value={selected}
                onChange={(e) => setCreditId(e.target.value)}
                required
              >
                <option value="">{t('credit.selectPlaceholder')}</option>
                {credits.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t('credit.option', {
                      id: c.id,
                      parent: c.parent_name,
                      amount: formatVND(c.available),
                      reason: c.reason || '—',
                    })}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !credits?.length}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('credit.applying') : t('credit.apply')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type LineDraft = { description: string; quantity: string; price: string };

/** Tạo hóa đơn học phí tháng hàng loạt: chọn kỳ + lớp -> xem trước -> tạo (chạy lại không nhân đôi). */
function BulkInvoiceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation(['tuition', 'common']);
  const toast = useToast();
  const [period, setPeriod] = useState(todayVN().slice(0, 7));
  const [classId, setClassId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [preview, setPreview] = useState<(BulkInvoiceResult & { key: string }) | null>(null);
  // Bản xem trước chỉ hợp lệ cho đúng bộ tham số đã gửi (đổi tham số khi đang tải -> bỏ kết quả về muộn)
  const paramsKey = `${period}|${classId}|${dueDate}`;
  const [busy, setBusy] = useState(false);
  const { data: classes } = useLoad(() => fetchAllPages((p) => classesApi.list('', p)), []);

  const body = (dry_run: boolean) => ({
    period,
    ...(classId ? { class_id: Number(classId) } : {}),
    ...(dueDate ? { due_date: dueDate } : {}),
    lang: i18n.language === 'en' ? 'en' : 'vi',
    dry_run,
  });
  const run = async (dry: boolean) => {
    setBusy(true);
    try {
      const key = paramsKey;
      const r = await invoicesApi.bulk(body(dry));
      if (dry) setPreview((cur) => (key === keyRef.current ? { ...r, key } : cur));
      else {
        toast(t('bulk.created', { count: r.created }), 'success');
        onDone();
      }
    } catch (err) {
      toastApiError(toast, err, t('bulk.error'));
    } finally {
      setBusy(false);
    }
  };
  // Đổi tham số thì bản xem trước cũ không còn đúng
  const keyRef = useRef(paramsKey);
  keyRef.current = paramsKey;
  useEffect(() => setPreview(null), [paramsKey]);

  return (
    <Modal title={t('bulk.title')} onClose={onClose} wide>
      <p className="muted">{t('bulk.desc')}</p>
      <div className="form-grid">
        <Field label={t('invoiceForm.period')} required>
          <input
            className="text-input"
            type="month"
            required
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
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
        <Field label={t('invoiceForm.class')} span>
          <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{t('bulk.allClasses')}</option>
            {(classes ?? [])
              .filter((c) => c.tuition_fee > 0)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {t('invoiceForm.classOption', { name: c.name, fee: formatVND(c.tuition_fee) })}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {preview && (
        <div className="bulk-preview" aria-live="polite">
          <p>
            <Trans
              i18nKey="bulk.summary"
              ns="tuition"
              count={preview.created}
              values={{ count: preview.created, total: formatVND(preview.total), skipped: preview.skipped }}
              components={{ strong: <strong /> }}
            />
          </p>
          {preview.preview.length > 0 && (
            <div className="table-wrap bulk-preview-table">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('receipt.student')}</th>
                    <th scope="col">{t('receipt.class')}</th>
                    <th scope="col" className="num">
                      {t('receipt.amount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r) => (
                    <tr key={`${r.student_id}-${r.class_name}`}>
                      <td>
                        {r.student_name} <span className="muted mono">({r.student_code})</span>
                      </td>
                      <td>{r.class_name}</td>
                      <td className="num">{formatVND(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        {preview && preview.key === paramsKey && preview.created > 0 ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(false)}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('bulk.confirm', { count: preview.created })}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !period}
            onClick={() => void run(true)}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('bulk.preview')}
          </button>
        )}
      </div>
    </Modal>
  );
}

function InvoiceFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['tuition', 'common']);
  // ADM-6: tìm học viên server-side (debounce) thay vì tải sẵn 100 học viên mới nhất
  const [studentSearch, setStudentSearch] = useState('');
  const { results: studentResults } = useStudentSearch(studentSearch);
  const [picked, setPicked] = useState<Student | null>(null);
  const students =
    picked && !studentResults.some((s) => s.id === picked.id) ? [picked, ...studentResults] : studentResults;
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  // v28: dòng hóa đơn; tổng = tổng dòng - giảm trừ (server tính lại, client chỉ hiển thị)
  const [lines, setLines] = useState<LineDraft[]>([{ description: '', quantity: '1', price: '' }]);
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [period, setPeriod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Focus vào field lỗi đầu tiên sau submit (skill 8.2)
  const studentRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const filled = lines.filter((l) => l.description.trim() || l.price);
  const subtotal = filled.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.price) || 0), 0);
  const total = Math.round(subtotal - (Number(discount) || 0));
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const toast = useToast();

  useEffect(() => {
    fetchAllPages((p) => classesApi.list('', p))
      .then(setClasses)
      .catch((err: unknown) => toastApiError(toast, err, t('states.loadError', { ns: 'common' })));
  }, [toast, t]);

  // Auto-fill tuition fee when a class is picked
  const pickClass = (cid: string) => {
    setClassId(cid);
    const c = classes.find((x) => String(x.id) === cid);
    if (c) {
      setLine(0, {
        description: t('invoiceForm.tuitionLine', { name: c.name }),
        quantity: '1',
        price: moneyDigits(c.tuition_fee),
      });
    }
  };
  const dirty = !!(studentId || classId || filled.length || discount || dueDate || note || period);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!studentId) errs.studentId = t('invoiceForm.studentRequired');
    const badLine = filled.some(
      (l) => !l.description.trim() || !(Number(l.quantity) > 0) || !(Number(l.price) >= 0) || l.price === ''
    );
    if (!filled.length || badLine || subtotal <= 0) errs.amount = t('invoiceForm.linesInvalid');
    else if (total <= 0) errs.amount = t('invoiceForm.discountTooLarge');
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
        items: filled.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit_price: Number(l.price),
        })),
        discount_amount: Number(discount) || 0,
        discount_reason: Number(discount) ? discountReason.trim() || null : null,
        period: period || null,
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
    <Modal title={t('invoiceForm.title')} onClose={onClose} dirty={dirty}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('invoiceForm.searchStudent')} span>
            <input
              className="text-input"
              type="search"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder={t('invoiceForm.searchStudentPlaceholder')}
            />
          </Field>
          <Field label={t('invoiceForm.student')} span error={fieldErrors.studentId} required>
            <select
              ref={studentRef}
              className="text-input"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setPicked(students.find((s) => String(s.id) === e.target.value) ?? null);
              }}
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
          <Field label={t('invoiceForm.lines')} span group error={fieldErrors.amount} required>
            <div className="line-editor">
              {lines.map((l, i) => (
                <div className="line-row" key={i}>
                  <input
                    ref={i === 0 ? amountRef : undefined}
                    className="text-input"
                    aria-label={t('lines.description')}
                    placeholder={t('lines.description')}
                    maxLength={200}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                  <input
                    className="text-input line-qty"
                    type="number"
                    min={1}
                    step="any"
                    aria-label={t('lines.quantity')}
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                  <div className="line-price">
                    <MoneyInput
                      className="text-input"
                      aria-label={t('lines.unitPrice')}
                      placeholder={t('lines.unitPrice')}
                      value={l.price}
                      onChange={(v) => setLine(i, { price: v })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost"
                    aria-label={t('lines.remove')}
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
              {lines.length < 20 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm line-add"
                  onClick={() => setLines((prev) => [...prev, { description: '', quantity: '1', price: '' }])}
                >
                  <Icon name="plus" size={14} />
                  {t('lines.add')}
                </button>
              )}
            </div>
          </Field>
          <Field label={t('lines.discount')}>
            <MoneyInput className="text-input" value={discount} onChange={setDiscount} />
          </Field>
          <Field label={t('invoiceForm.discountReason')}>
            <input
              className="text-input"
              maxLength={200}
              value={discountReason}
              disabled={!Number(discount)}
              placeholder={t('invoiceForm.discountReasonPlaceholder')}
              onChange={(e) => setDiscountReason(e.target.value)}
            />
          </Field>
          <Field label={t('invoiceForm.period')} hint={t('invoiceForm.periodHint')}>
            <input
              className="text-input"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </Field>
          <div className="line-total" aria-live="polite">
            {t('lines.total')}: <strong>{formatVND(Math.max(0, total))}</strong>
          </div>
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

export function PayModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['tuition', 'common']);
  const remain = remainingOf(invoice);
  const [amount, setAmount] = useState(String(remain));
  const [method, setMethod] = useState<PaymentMethodCode>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Idempotency-Key ổn định cho 1 lần thu (per-intent): retry cùng thao tác không thu
  // trùng; mở modal mới là intent mới nên thu tiếp cùng số tiền vẫn ghi nhận được.
  // Không dùng key theo invoice+amount vì 2 lần thu cùng số tiền trong 24h sẽ bị dedupe nhầm.
  const [idemKey] = useState(() => `pay-${invoice.id}-${crypto.randomUUID()}`);
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
      await invoicesApi.recordPayment(
        invoice.id,
        {
          amount: Number(amount),
          // Giữ tương thích server/DB: gửi chuỗi tiếng Việt cũ thay vì code
          method: PAYMENT_METHODS.find((m) => m.code === method)?.legacy ?? method,
          note: note || null,
        },
        idemKey
      );
      toast(t('pay.recorded'), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('pay.payError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('pay.title')}
      onClose={onClose}
      dirty={amount !== String(remain) || method !== 'cash' || note !== ''}
    >
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
            <MoneyInput
              ref={refFor('amount')}
              className="text-input"
              value={amount}
              onChange={(v) => {
                setAmount(v);
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
  // Idempotency-Key per-intent như PayModal: retry không hoàn trùng, mở modal mới vẫn hoàn tiếp được.
  const [idemKey] = useState(() => `refund-${invoice.id}-${crypto.randomUUID()}`);
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
      await invoicesApi.refund(
        invoice.id,
        {
          amount: Number(amount),
          reason: reason || undefined,
        },
        idemKey
      );
      toast(t('refund.done'), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('refund.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('refund.title')} onClose={onClose} dirty={amount !== String(paid) || reason !== ''}>
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
            <MoneyInput
              ref={refFor('amount')}
              className="text-input"
              value={amount}
              onChange={(v) => {
                setAmount(v);
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
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const toast = useToast();

  const { data: res, loading, error, reload } = useLoad(() => invoicesApi.listDebt({ page }), [page]);
  const debts: DebtRow[] = res?.data ?? [];
  useLoadErrorToast(error, t('debt.loadError'));
  useClampPage(res, page, setQ);
  // UX-8: số học viên + tổng nợ của toàn bộ danh sách (server), không phải cộng 20 dòng trang hiện tại
  const { data: summary } = useLoad(() => invoicesApi.getDebtSummary(), []);

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
        {summary && (
          <span className="muted">
            <Trans
              i18nKey="debt.summary"
              ns="tuition"
              values={{ count: summary.debtorCount, total: formatVND(summary.totalDebt) }}
              components={{ strong: <strong className="debt-amount" /> }}
            />
          </span>
        )}
        <span className="spacer" />
        <ExportButton kind="debt" />
      </div>
      {loading && !res ? (
        <TableSkeleton cols={6} />
      ) : error && !res ? (
        <LoadError onRetry={reload} />
      ) : debts.length === 0 ? (
        <EmptyState icon="check-circle" title={t('debt.emptyTitle')} desc={t('debt.emptyDesc')} />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table table-stack">
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
                    <Link className="link" to={`/app/students/${d.id}`}>
                      {d.name}
                    </Link>
                    <div className="cell-sub mono">{d.code}</div>
                  </td>
                  <td data-label={t('debt.table.phone')}>{d.phone || <EmptyCell />}</td>
                  <td data-label={t('debt.table.total')} className="num">
                    {formatVND(d.total)}
                  </td>
                  <td data-label={t('debt.table.paid')} className="num">
                    {formatVND(d.paid)}
                  </td>
                  <td data-label={t('debt.table.debt')} className="num debt-amount">
                    {formatVND(d.debt)}
                  </td>
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
      {res && (
        <Pagination
          pagination={res.pagination}
          onChange={(p) => setQ({ page: String(p) })}
          loading={loading}
        />
      )}
    </>
  );
}

/** Toast lỗi tải 1 lần mỗi lỗi mới (useLoad giữ data cũ, nên lỗi khi tải lại chỉ báo qua toast). */
function useLoadErrorToast(error: unknown, fallback: string) {
  const toast = useToast();
  useEffect(() => {
    if (error) toastApiError(toast, error, fallback);
  }, [error, toast]);
}

/** ADM-13: xóa/duyệt dòng cuối của trang cuối -> lùi về trang hợp lệ thay vì hiện "trống". */
function useClampPage(
  res: { pagination: PaginationMeta } | undefined,
  page: number,
  setQ: (patch: { page: string }) => void
) {
  useEffect(() => {
    if (!res) return;
    const p = clampPage(page, res.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [res, page, setQ]);
}
