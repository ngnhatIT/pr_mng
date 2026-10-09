import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoicesApi, paymentsApi, InvoiceItem, PendingPayment, DebtRow } from './tuition.api';
import { studentsApi, Student } from '../students/students.api';
import { classesApi, ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { INVOICE_STATUS_LABEL, formatVND, formatDate } from '../../shared/types';
import './Tuition.css';

export function remindKind(dueDate: string | null): 'overdue' | 'upcoming' {
  const today = new Date().toISOString().slice(0, 10);
  return dueDate && dueDate < today ? 'overdue' : 'upcoming';
}

export function Tuition() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState(tabParam === 'debt' || tabParam === 'pending' ? tabParam : 'invoices');

  const switchTab = (t: 'invoices' | 'debt' | 'pending') => {
    setTab(t);
    setSearchParams(t === 'invoices' ? {} : { tab: t }, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader title="Học phí" desc="Phiếu thu, công nợ và duyệt thanh toán online" />
      <div className="tabs">
        <button className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => switchTab('invoices')}>
          Phiếu thu
        </button>
        <button className={`tab${tab === 'debt' ? ' active' : ''}`} onClick={() => switchTab('debt')}>
          Công nợ
        </button>
        <button className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => switchTab('pending')}>
          Chờ duyệt
        </button>
      </div>
      {tab === 'invoices' ? <InvoiceList /> : tab === 'debt' ? <DebtList /> : <PendingPayments />}
    </div>
  );
}

function PendingPayments() {
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
      toast(err instanceof Error ? err.message : 'Không tải được danh sách chờ duyệt', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (p: PendingPayment, action: 'approve' | 'reject') => {
    setBusyId(p.id);
    try {
      if (action === 'approve') await paymentsApi.approve(p.id);
      else await paymentsApi.reject(p.id);
      toast(action === 'approve' ? 'Đã duyệt thanh toán' : 'Đã từ chối thanh toán', 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thất bại', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">Thanh toán do phụ huynh báo "đã chuyển khoản", chờ trung tâm xác nhận.</span>
      </div>
      {loading ? (
        <TableSkeleton cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title="Không có gì chờ duyệt"
          desc="Các thanh toán do phụ huynh báo “đã chuyển khoản” sẽ hiện ở đây."
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Số tiền</th>
                <th>Phương thức</th>
                <th>Thời gian báo</th>
                <th>Ghi chú</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.student_name} <span className="muted mono">({p.student_code})</span>
                  </td>
                  <td className="num">{formatVND(p.amount)}</td>
                  <td>{p.method || 'Chuyển khoản'}</td>
                  <td>{formatDate(p.paid_at)}</td>
                  <td>{p.note || '-'}</td>
                  <td className="td-right">
                    <span className="tuition-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => void moderate(p, 'approve')}
                        disabled={busyId === p.id}
                      >
                        Duyệt
                      </button>
                      <button
                        className="btn btn-sm btn-danger-ghost"
                        onClick={() => void moderate(p, 'reject')}
                        disabled={busyId === p.id}
                      >
                        Từ chối
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}
    </>
  );
}

function InvoiceList() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [debtSummary, setDebtSummary] = useState<{ totalDebt: number; debtorCount: number } | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [paying, setPaying] = useState<InvoiceItem | null>(null);
  const [crediting, setCrediting] = useState<InvoiceItem | null>(null);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const remindInvoice = async (inv: InvoiceItem) => {
    setRemindingId(inv.id);
    try {
      const r = await invoicesApi.remind(inv.id, remindKind(inv.due_date));
      toast(
        r.demo ? `Đã ghi log demo: ${r.message}` : r.message,
        r.status === 'failed' ? 'error' : 'success'
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi nhắc thất bại', 'error');
    } finally {
      setRemindingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoicesApi.list(search, status, { page });
      setInvoices(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được phiếu thu', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, search, page, toast]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const totalDebt = debtSummary?.totalDebt ?? invoices.reduce((s, i) => s + (i.amount - (i.paid || 0)), 0);

  useEffect(() => {
    invoicesApi
      .getDebtSummary()
      .then(setDebtSummary)
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="toolbar tuition-toolbar">
        <input
          className="text-input search-input"
          placeholder="Tìm theo tên/mã học viên..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="unpaid">Chưa thanh toán</option>
          <option value="partial">Thanh toán một phần</option>
          <option value="paid">Đã thanh toán</option>
        </select>
        <span className="spacer" />
        <span className="debt-pill" aria-live="polite">
          Còn nợ: <strong className="debt-amount">{formatVND(totalDebt)}</strong>
        </span>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Tạo phiếu thu
        </button>
      </div>

      {loading ? (
        <TableSkeleton cols={8} />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon="banknote"
          title="Chưa có phiếu thu nào"
          desc="Tạo phiếu thu học phí cho học viên để bắt đầu thu tiền."
          action={
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Tạo phiếu thu
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>Lớp</th>
                <th className="th-right">Số tiền</th>
                <th className="th-right">Đã thu</th>
                <th className="th-right">Còn nợ</th>
                <th>Hạn nộp</th>
                <th>Trạng thái</th>
                <th className="th-right">Thao tác</th>
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
                    <td>{inv.class_name || '-'}</td>
                    <td className="num">{formatVND(inv.amount)}</td>
                    <td className="num">{formatVND(paid)}</td>
                    <td className="num debt-amount">{formatVND(inv.amount - paid)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>
                      <span className={`badge badge-${inv.status}`}>{INVOICE_STATUS_LABEL[inv.status]}</span>
                    </td>
                    <td className="td-right nowrap">
                      {inv.status !== 'paid' && (
                        <span className="tuition-actions">
                          <button
                            className="btn btn-sm"
                            onClick={() => void remindInvoice(inv)}
                            disabled={remindingId === inv.id}
                            title="Gửi nhắc học phí qua Zalo"
                          >
                            {remindingId === inv.id ? 'Đang gửi...' : 'Nhắc Zalo'}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => setCrediting(inv)}
                            title="Áp dụng credits của phụ huynh vào hóa đơn"
                          >
                            Credits
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => setPaying(inv)}>
                            Thu tiền
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

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
  const [creditId, setCreditId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const remain = invoice.amount - (invoice.paid || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditId.trim()) {
      toast('Vui lòng nhập ID credits', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await invoicesApi.applyCredit(invoice.id, Number(creditId));
      toast(`Đã áp dụng ${formatVND(r.applied)} credits vào hóa đơn`, 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Áp dụng thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Áp dụng credits vào hóa đơn" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="confirm-text">
          {invoice.student_name} ({invoice.student_code}) - còn nợ{' '}
          <strong className="debt-amount">{formatVND(remain)}</strong>
        </p>
        <p className="muted">
          Nhập <strong>ID credits</strong> của phụ huynh (xem trong trang Giới thiệu của phụ huynh hoặc quản
          lý credits). Hệ thống sẽ trừ credits khả dụng vào số tiền còn nợ của hóa đơn.
        </p>
        <Field label="ID credits *">
          <input
            className="text-input"
            type="number"
            min={1}
            value={creditId}
            onChange={(e) => setCreditId(e.target.value)}
            placeholder="VD: 12"
            required
          />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang áp dụng...' : 'Áp dụng'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceFormModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      studentsApi.list('', 'studying', { limit: 100 }),
      classesApi.list({ limit: 100 }).then((r) => r.data),
    ])
      .then(([s, c]) => {
        setStudents(s.data);
        setClasses(c);
      })
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  // Tự điền học phí khi chọn lớp
  const pickClass = (cid: string) => {
    setClassId(cid);
    const c = classes.find((x) => String(x.id) === cid);
    if (c) setAmount(String(c.tuition_fee));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId) {
      toast('Vui lòng chọn học viên', 'error');
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
      toast('Đã tạo phiếu thu', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tạo phiếu thu" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Học viên *" span>
            <select
              className="text-input"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            >
              <option value="">- Chọn học viên -</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lớp học" span>
            <select className="text-input" value={classId} onChange={(e) => pickClass(e.target.value)}>
              <option value="">- Không gắn lớp -</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} - {formatVND(c.tuition_fee)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Số tiền (đ) *">
            <input
              className="text-input"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Hạn nộp">
            <input
              className="text-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="Ghi chú" span>
            <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang tạo...' : 'Tạo phiếu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PayModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const paid = invoice.paid || 0;
  const remain = invoice.amount - paid;
  const [amount, setAmount] = useState(String(remain));
  const [method, setMethod] = useState('Tiền mặt');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await invoicesApi.recordPayment(invoice.id, {
        amount: Number(amount),
        method,
        note: note || null,
      });
      toast('Đã ghi nhận thanh toán', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thu tiền thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Thu tiền học phí" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="confirm-text">
          {invoice.student_name} - còn nợ <strong className="debt-amount">{formatVND(remain)}</strong>
        </p>
        <div className="form-grid">
          <Field label="Số tiền thu (đ) *">
            <input
              className="text-input"
              type="number"
              min={1}
              max={remain}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Phương thức">
            <select className="text-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>Tiền mặt</option>
              <option>Chuyển khoản</option>
              <option>Quẹt thẻ</option>
              <option>Ví điện tử</option>
            </select>
          </Field>
          <Field label="Ghi chú" span>
            <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu...' : 'Xác nhận thu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DebtList() {
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
      toast(err instanceof Error ? err.message : 'Không tải được công nợ', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

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
      toast('Không tìm thấy hóa đơn cần nhắc', 'error');
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
      toast(
        `Nhắc Zalo cho ${d.name}: ${sent} đã gửi, ${demo} demo, ${failed} thất bại`,
        failed > 0 ? 'error' : 'success'
      );
    } finally {
      setRemindingId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {debts.length} học viên còn nợ · Tổng: <strong className="debt-amount">{formatVND(total)}</strong>
        </span>
      </div>
      {loading ? (
        <TableSkeleton cols={6} />
      ) : debts.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title="Không còn công nợ"
          desc="Tất cả học viên đã thanh toán đầy đủ. Tuyệt vời!"
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Học viên</th>
                <th>SĐT</th>
                <th className="th-right">Tổng phải thu</th>
                <th className="th-right">Đã thu</th>
                <th className="th-right">Còn nợ</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.name} <span className="muted mono">({d.code})</span>
                  </td>
                  <td>{d.phone || '-'}</td>
                  <td className="num">{formatVND(d.total)}</td>
                  <td className="num">{formatVND(d.paid)}</td>
                  <td className="num debt-amount">{formatVND(d.debt)}</td>
                  <td className="td-right">
                    <button
                      className="btn btn-sm"
                      onClick={() => void remindStudent(d)}
                      disabled={remindingId === d.id}
                      title="Gửi nhắc học phí qua Zalo cho các hóa đơn chưa thanh toán"
                    >
                      {remindingId === d.id ? 'Đang gửi...' : 'Nhắc Zalo'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}
    </>
  );
}
