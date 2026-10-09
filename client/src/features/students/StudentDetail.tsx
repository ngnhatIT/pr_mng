import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { http } from '../../shared/api/client';
import { studentsApi } from './students.api';
import { useToast } from '../../shared/ui/toast';
import {
  Student,
  InvoiceItem,
  Grade,
  ClassItem,
  STUDENT_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  formatVND,
  formatDate,
} from '../../shared/types';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton, TableSkeleton } from '../../shared/components/Skeleton';

interface Detail {
  student: Student;
  classes: { id: number; name: string; enroll_status: string; enrolled_at: string }[];
  invoices: InvoiceItem[];
}

export function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const d = await http.get<Detail>(`/students/${id}`);
        setData(d);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Không tải được chi tiết', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, toast]);

  if (loading)
    return (
      <div className="page">
        <div className="profile-head" aria-hidden="true">
          <Skeleton width={64} height={64} radius={18} />
          <div style={{ flex: 1 }}>
            <Skeleton width="40%" height={24} radius={8} />
            <div style={{ marginTop: 10 }}>
              <Skeleton width="25%" height={14} />
            </div>
          </div>
        </div>
        <section className="card" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <div style={{ marginTop: 14 }}>
            <Skeleton height={14} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width="80%" height={14} />
          </div>
        </section>
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <EmptyState
          icon="user"
          title="Không tìm thấy học viên"
          desc="Học viên không tồn tại hoặc đã bị xóa."
        />
      </div>
    );
  const { student } = data;

  return (
    <div className="page">
      <Link className="link back-link" to="/app/students">
        ← Danh sách học viên
      </Link>
      <div className="profile-head">
        <div className="profile-avatar">{student.name.charAt(0).toUpperCase()}</div>
        <div className="profile-meta">
          <h1 className="page-title">
            {student.name} <span className="muted mono">({student.code})</span>
          </h1>
          <div className="profile-badges">
            <span className={`badge badge-${student.status}`}>{STUDENT_STATUS_LABEL[student.status]}</span>
          </div>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Thông tin cá nhân</h2>
          </div>
          <dl className="dl">
            <dt>Điện thoại</dt>
            <dd>{student.phone || '—'}</dd>
            <dt>Email</dt>
            <dd>{student.email || '—'}</dd>
            <dt>Ngày sinh</dt>
            <dd>{formatDate(student.dob)}</dd>
            <dt>Địa chỉ</dt>
            <dd>{student.address || '—'}</dd>
            <dt>Ghi chú</dt>
            <dd>{student.note || '—'}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Lớp đang theo học</h2>
          </div>
          {data.classes.length === 0 ? (
            <EmptyState icon="book" title="Chưa ghi danh lớp nào" />
          ) : (
            <ul className="list">
              {data.classes.map((c) => (
                <li key={c.id} className="list-item">
                  <Link className="link" to={`/app/classes/${c.id}`}>
                    {c.name}
                  </Link>
                  <span className="muted">từ {formatDate(c.enrolled_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Hóa đơn học phí</h2>
        </div>
        {data.invoices.length === 0 ? (
          <EmptyState icon="banknote" title="Chưa có hóa đơn nào" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lớp</th>
                  <th>Số tiền</th>
                  <th>Đã thu</th>
                  <th>Hạn nộp</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.class_name || '—'}</td>
                    <td className="num">{formatVND(inv.amount)}</td>
                    <td className="num">{formatVND(inv.paid || 0)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>
                      <span className={`badge badge-${inv.status}`}>{INVOICE_STATUS_LABEL[inv.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <GradesSection studentId={Number(id)} />
    </div>
  );
}

function GradesSection({ studentId }: { studentId: number }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Grade | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await studentsApi.listGrades(studentId, { limit: 100 });
      setGrades(res.data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được điểm số', 'error');
    } finally {
      setLoading(false);
    }
  }, [studentId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await http.del(`/grades/${deleting.id}`);
      toast('Đã xóa điểm', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Điểm số</h2>
        <button className="btn btn-sm btn-primary" onClick={() => setShowForm(true)}>
          + Nhập điểm
        </button>
      </div>
      {loading ? (
        <TableSkeleton cols={6} />
      ) : grades.length === 0 ? (
        <EmptyState
          icon="cap"
          title="Chưa có điểm số nào"
          desc="Nhấn “+ Nhập điểm” để thêm điểm cho học viên."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bài kiểm tra</th>
                <th>Lớp</th>
                <th>Điểm</th>
                <th>Nhận xét</th>
                <th>Ngày nhập</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>{g.class_name || '—'}</td>
                  <td className="num">
                    <strong>
                      {g.score}/{g.max_score}
                    </strong>
                  </td>
                  <td>{g.comment || '—'}</td>
                  <td>{formatDate(g.created_at)}</td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(g)}>
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <StudentGradeFormModal
          studentId={studentId}
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            void load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa điểm"
          message={`Xóa điểm "${deleting.title}" (${deleting.score}/${deleting.max_score})?`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </section>
  );
}

function StudentGradeFormModal({
  studentId,
  onClose,
  onDone,
}: {
  studentId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('10');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    http
      .get<ClassItem[]>('/classes')
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await http.post('/grades', {
        student_id: studentId,
        class_id: classId ? Number(classId) : null,
        title,
        score: Number(score),
        max_score: Number(maxScore) || 10,
        comment: comment || null,
      });
      toast('Đã nhập điểm', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Nhập điểm thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nhập điểm" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Lớp">
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— Không gắn lớp —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tên bài kiểm tra *">
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Điểm *">
            <input
              className="text-input"
              type="number"
              step="0.25"
              min={0}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              required
            />
          </Field>
          <Field label="Thang điểm">
            <input
              className="text-input"
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </Field>
          <Field label="Nhận xét" span>
            <textarea
              className="text-input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
