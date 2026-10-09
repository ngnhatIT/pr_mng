import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parentApi, VietQRInfo } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Icon, IconName } from '../../shared/components/icons';
import './parent.css';
import { EmptyState } from '../../shared/components/EmptyState';
import { QuizTaker } from './QuizTaker';
import { SubmitModal } from './SubmitModal';
import { MySubmissionsModal } from './MySubmissionsModal';
import { Skeleton } from '../../shared/components/Skeleton';
import { renderMarkdown } from '../../shared/components/RichTextarea';
import {
  ChildOverview,
  ChildOverviewInvoice,
  Grade,
  HomeworkItem,
  INVOICE_STATUS_LABEL,
  formatVND,
  formatDate,
} from '../../shared/types';

type Tab = 'schedule' | 'attendance' | 'tuition' | 'grades' | 'homework';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'schedule', label: 'Lịch học', icon: 'calendar' },
  { id: 'attendance', label: 'Điểm danh', icon: 'clipboard' },
  { id: 'tuition', label: 'Học phí', icon: 'banknote' },
  { id: 'grades', label: 'Điểm số', icon: 'cap' },
  { id: 'homework', label: 'Bài tập', icon: 'file' },
];

export function ChildDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ChildOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('schedule');
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await parentApi.childOverview(id || '');
      setData(d);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được thông tin', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <div className="parent-page">
        <div className="parent-child-head" aria-hidden="true">
          <Skeleton width={56} height={56} radius={28} />
          <div style={{ flex: 1 }}>
            <Skeleton width="45%" height={22} radius={8} />
            <div style={{ marginTop: 8 }}>
              <Skeleton width="25%" height={13} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }} aria-hidden="true">
          <Skeleton height={40} radius={20} />
        </div>
        <section className="card" style={{ marginTop: 16 }} aria-hidden="true">
          <Skeleton width="35%" height={18} />
          <div style={{ marginTop: 12 }}>
            <Skeleton height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="75%" height={14} />
          </div>
        </section>
      </div>
    );
  if (!data)
    return (
      <div className="parent-page">
        <EmptyState icon="user" title="Không tìm thấy học viên" desc="Thông tin học viên không tồn tại." />
      </div>
    );

  return (
    <div className="parent-page">
      <Link className="link back-link" to="/parent">
        <Icon name="arrow-left" size={16} />
        Trang chủ
      </Link>
      <div className="parent-child-head">
        <div className="child-avatar child-avatar-lg">{data.student.name.charAt(0).toUpperCase()}</div>
        <div>
          <h1 className="parent-title">{data.student.name}</h1>
          <div className="muted mono">{data.student.code}</div>
        </div>
      </div>

      <div className="tabs parent-tabs pill-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'schedule' && <ScheduleTab data={data} />}
      {tab === 'attendance' && <AttendanceTab data={data} />}
      {tab === 'tuition' && <TuitionTab data={data} onPaid={() => void load()} />}
      {tab === 'grades' && <GradesTab data={data} />}
      {tab === 'homework' && <HomeworkTab data={data} onChanged={() => void load()} />}
    </div>
  );
}

function ScheduleTab({ data }: { data: ChildOverview }) {
  return (
    <>
      <section className="card">
        <h3 className="card-title">Các lớp đang học</h3>
        {data.classes.length === 0 ? (
          <EmptyState icon="book" title="Chưa ghi danh lớp nào" />
        ) : (
          data.classes.map((c) => (
            <div key={c.id} className="class-info-card">
              <strong>{c.name}</strong>
              <div className="muted">
                Lịch: {c.schedule || '-'}
                {c.teacher_name && <> · GV: {c.teacher_name}</>}
                {c.room_name && <> · Phòng: {c.room_name}</>}
              </div>
            </div>
          ))
        )}
      </section>
      <section className="card">
        <h3 className="card-title">Buổi học sắp tới</h3>
        {data.upcomingSessions.length === 0 ? (
          <EmptyState icon="calendar" title="Chưa có buổi học nào sắp diễn ra" />
        ) : (
          <ul className="list">
            {data.upcomingSessions.map((s) => (
              <li key={s.id} className="list-item">
                <div>
                  <strong>{formatDate(s.date)}</strong>
                  <span className="muted"> · {s.class_name}</span>
                  {s.topic && <div className="muted">{s.topic}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AttendanceTab({ data }: { data: ChildOverview }) {
  const a = data.attendance;
  const stats: { label: string; value: number; badge: string }[] = [
    { label: 'Có mặt', value: a.present, badge: 'badge-present' },
    { label: 'Muộn', value: a.late, badge: 'badge-late' },
    { label: 'Vắng', value: a.absent, badge: 'badge-absent' },
  ];
  return (
    <section className="card">
      <h3 className="card-title">Thống kê điểm danh</h3>
      <div className="stat-grid stat-grid-2">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">
              <span className={`badge ${s.badge}`}>{s.label}</span>
            </div>
          </div>
        ))}
        <div className="stat-card stat-card-highlight">
          <div className="stat-value">{(a.rate * 100).toFixed(0)}%</div>
          <div className="stat-label">Tỷ lệ chuyên cần</div>
        </div>
      </div>
      <p className="muted">Tổng {a.total} buổi đã điểm danh.</p>
    </section>
  );
}

function TuitionTab({ data, onPaid }: { data: ChildOverview; onPaid: () => void }) {
  const [paying, setPaying] = useState<ChildOverviewInvoice | null>(null);
  return (
    <section className="card">
      <h3 className="card-title">Hóa đơn học phí</h3>
      {data.invoices.length === 0 ? (
        <EmptyState icon="banknote" title="Chưa có hóa đơn nào" />
      ) : (
        <div className="invoice-list">
          {data.invoices.map((inv) => {
            const remain = inv.amount - (inv.paid || 0);
            return (
              <div key={inv.id} className="invoice-card">
                <div className="invoice-card-head">
                  <strong>{inv.class_name || 'Học phí'}</strong>
                  <span className={`badge badge-${inv.status}`}>{INVOICE_STATUS_LABEL[inv.status]}</span>
                </div>
                <dl className="dl dl-compact">
                  <dt>Số tiền</dt>
                  <dd className="num">{formatVND(inv.amount)}</dd>
                  <dt>Đã trả</dt>
                  <dd className="num">{formatVND(inv.paid || 0)}</dd>
                  <dt>Còn lại</dt>
                  <dd className="num debt-amount">
                    <strong>{formatVND(remain)}</strong>
                  </dd>
                  <dt>Hạn nộp</dt>
                  <dd>{formatDate(inv.due_date)}</dd>
                </dl>
                {inv.note && <p className="muted">{inv.note}</p>}
                {inv.status !== 'paid' && (
                  <button className="btn btn-primary btn-block btn-pay" onClick={() => setPaying(inv)}>
                    Thanh toán {formatVND(remain)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {paying && (
        <PayModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            onPaid();
          }}
        />
      )}
    </section>
  );
}

function PayModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: ChildOverviewInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'qr'>('menu');
  const [qr, setQr] = useState<VietQRInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const remain = invoice.amount - (invoice.paid || 0);

  const loadQR = async () => {
    setBusy(true);
    try {
      const data = await parentApi.vietqr(invoice.id);
      setQr(data);
      setMode('qr');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được mã QR', 'error');
    } finally {
      setBusy(false);
    }
  };

  const payVNPay = async () => {
    setBusy(true);
    try {
      const data = await parentApi.vnpay(invoice.id);
      window.open(data.pay_url, '_blank');
      toast('Đã mở cổng thanh toán VNPay trong tab mới', 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tạo được link VNPay', 'error');
    } finally {
      setBusy(false);
    }
  };

  const claimPaid = async () => {
    setBusy(true);
    try {
      await parentApi.claimPaid(invoice.id);
      toast('Đã ghi nhận. Trung tâm sẽ xác nhận thanh toán của bạn sớm.', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Thanh toán ${formatVND(remain)}`} onClose={onClose}>
      {mode === 'menu' && (
        <div className="pay-menu">
          <p className="confirm-text">
            Chọn cách thanh toán cho hóa đơn "{invoice.class_name || 'Học phí'}":
          </p>
          <button
            className="btn btn-primary btn-block pay-option"
            onClick={() => void loadQR()}
            disabled={busy}
          >
            <Icon name="qr" size={20} />
            {busy ? 'Đang tạo mã...' : 'Quét VietQR'}
          </button>
          <button className="btn btn-block pay-option" onClick={() => void payVNPay()} disabled={busy}>
            <Icon name="card" size={20} />
            {busy ? 'Đang tạo link...' : 'Thanh toán VNPay'}
          </button>
          <button className="btn btn-block pay-option" onClick={() => void claimPaid()} disabled={busy}>
            <Icon name="check-circle" size={20} />
            {busy ? 'Đang gửi...' : 'Tôi đã chuyển khoản'}
          </button>
        </div>
      )}
      {mode === 'qr' && qr && (
        <div className="qr-box">
          <img src={qr.qr_url} alt="Mã QR thanh toán" />
          <dl className="dl dl-compact">
            <dt>Số tiền</dt>
            <dd className="num">
              <strong>{formatVND(qr.amount)}</strong>
            </dd>
            <dt>Ngân hàng</dt>
            <dd>{qr.bank}</dd>
            <dt>Số TK</dt>
            <dd className="mono">{qr.account_no}</dd>
            <dt>Chủ TK</dt>
            <dd>{qr.account_name}</dd>
            <dt>Nội dung</dt>
            <dd className="mono">{qr.addInfo}</dd>
          </dl>
          <button className="btn btn-block" onClick={() => setMode('menu')}>
            ← Chọn cách khác
          </button>
        </div>
      )}
    </Modal>
  );
}

function GradesTab({ data }: { data: ChildOverview }) {
  const grades = [...data.grades].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <section className="card">
      <h3 className="card-title">Điểm số</h3>
      {grades.length === 0 ? (
        <EmptyState icon="cap" title="Chưa có điểm số nào" />
      ) : (
        <>
          <div className="progress-line">
            <ProgressChart grades={grades} />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bài kiểm tra</th>
                  <th>Lớp</th>
                  <th>Điểm</th>
                  <th>Nhận xét</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.id}>
                    <td>{g.title}</td>
                    <td>{g.class_name || '-'}</td>
                    <td className="num">
                      <strong>
                        {g.score}/{g.max_score}
                      </strong>
                    </td>
                    <td>{g.comment || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function ProgressChart({ grades }: { grades: Grade[] }) {
  const W = 400;
  const H = 180;
  const PAD = 30;
  if (grades.length === 0) return null;
  const pct = grades.map((g) =>
    g.max_score > 0 ? Math.max(0, Math.min(100, (g.score / g.max_score) * 100)) : 0
  );
  const xs = grades.map((_, i) =>
    grades.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (grades.length - 1)
  );
  const ys = pct.map((p) => H - PAD - (p / 100) * (H - PAD * 2));
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${PAD},${(H - PAD).toFixed(1)} ${points} ${(W - PAD).toFixed(1)},${(H - PAD).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="progress-svg" role="img" aria-label="Biểu đồ tiến bộ">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#dfe4ee" />
      <polygon points={area} fill="rgba(37,99,235,0.12)" />
      <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={ys[i]} r="4" fill="#2563eb" />
          <text x={x} y={ys[i] - 8} textAnchor="middle" fontSize="11" fill="#1a2233">
            {pct[i].toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

function HomeworkTab({ data, onChanged }: { data: ChildOverview; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [takingQuiz, setTakingQuiz] = useState<HomeworkItem | null>(null);
  const [submitting, setSubmitting] = useState<HomeworkItem | null>(null);
  const [viewingSubs, setViewingSubs] = useState<HomeworkItem | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const studentId = data.student.id;

  const toggle = async (h: HomeworkItem) => {
    if (busy) return;
    setBusy(h.id);
    try {
      if (h.completed) {
        await parentApi.unmarkHomeworkDone(h.id, studentId);
      } else {
        await parentApi.markHomeworkDone(h.id, studentId);
        toast('Tuyệt vời! Đã đánh dấu hoàn thành', 'success');
      }
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
    } finally {
      setBusy(null);
    }
  };

  const done = data.homework.filter((h) => h.completed);
  const overdue = data.homework.filter((h) => !h.completed && h.due_date && h.due_date < today);
  const todo = data.homework.filter((h) => !h.completed && (!h.due_date || h.due_date >= today));

  const renderScore = (h: HomeworkItem) => {
    if (h.score === null || h.score === undefined) return null;
    return (
      <span className="badge badge-paid" style={{ marginLeft: 8 }}>
        {h.score}{h.max_score != null ? `/${h.max_score}` : ''}đ
      </span>
    );
  };

  const renderItem = (h: HomeworkItem) => {
    const isDone = !!h.completed;
    const isOverdue = !isDone && h.due_date && h.due_date < today;
    const isQuiz = h.kind === 'quiz';
    return (
      <div key={h.id} className={`hw-item ${isDone ? 'hw-item-done' : ''}`}>
        {!isQuiz && (
          <button
            className={`hw-check ${isDone ? 'done' : ''}`}
            onClick={() => void toggle(h)}
            disabled={busy === h.id}
            title={isDone ? 'Bỏ đánh dấu' : 'Đánh dấu đã làm xong'}
            aria-label={isDone ? 'Bỏ đánh dấu đã làm xong' : 'Đánh dấu đã làm xong'}
          >
            {isDone ? <Icon name="check" size={14} /> : null}
          </button>
        )}
        <div className="hw-body">
          <div className="hw-title">
            {isQuiz && <span className="badge badge-quiz" style={{ marginRight: 6 }}>Quiz</span>}
            {h.title}
            {renderScore(h)}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{h.class_name || ''}</div>
          {h.content && (
            <div className="homework-content" style={{ fontSize: 13 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(h.content) }} />
          )}
          {h.feedback && (
            <div className="hw-feedback">
              <Icon name="info" size={16} />
              <span>{h.feedback}</span>
            </div>
          )}
          <div className="hw-actions">
            {isQuiz && !isDone && (
              <button className="btn btn-sm btn-primary" onClick={() => setTakingQuiz(h)}>
                Làm bài ngay
              </button>
            )}
            {!isQuiz && !isDone && (
              <button className="btn btn-sm btn-primary" onClick={() => setSubmitting(h)}>
                <Icon name="upload" size={15} />
                Nộp bài
              </button>
            )}
            {!isQuiz && (
              <button className="btn btn-sm" onClick={() => setViewingSubs(h)}>
                <Icon name="file" size={15} />
                Bài đã nộp
              </button>
            )}
          </div>
        </div>
        <div>
          {h.due_date &&
            (isOverdue ? (
              <span className="badge badge-overdue">Quá hạn: {formatDate(h.due_date)}</span>
            ) : (
              <span className="badge badge-upcoming">Hạn: {formatDate(h.due_date)}</span>
            ))}
        </div>
      </div>
    );
  };

  return (
    <section className="card">
      <h3 className="card-title">Bài tập về nhà</h3>
      <p className="card-desc">Tick vào ô tròn khi con đã làm xong. Quiz trắc nghiệm làm trực tiếp và chấm tự động.</p>
      {data.homework.length === 0 ? (
        <EmptyState icon="file" title="Chưa có bài tập nào" />
      ) : (
        <>
          {todo.length > 0 && (
            <>
              <div className="hw-group-title">Cần làm ({todo.length})</div>
              {todo.map(renderItem)}
            </>
          )}
          {overdue.length > 0 && (
            <>
              <div className="hw-group-title" style={{ color: '#dc2626' }}>Quá hạn ({overdue.length})</div>
              {overdue.map(renderItem)}
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="hw-group-title">Đã hoàn thành ({done.length})</div>
              {done.map(renderItem)}
            </>
          )}
        </>
      )}
      {takingQuiz && (
        <QuizTaker
          homework={takingQuiz}
          studentId={studentId}
          onClose={() => setTakingQuiz(null)}
          onDone={() => { setTakingQuiz(null); onChanged(); }}
        />
      )}
      {submitting && (
        <SubmitModal
          homework={submitting}
          studentId={studentId}
          onClose={() => setSubmitting(null)}
          onDone={() => { setSubmitting(null); onChanged(); }}
        />
      )}
      {viewingSubs && (
        <MySubmissionsModal
          homework={viewingSubs}
          studentId={studentId}
          onClose={() => setViewingSubs(null)}
        />
      )}
    </section>
  );
}
