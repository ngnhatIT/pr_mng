import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { http } from '../../shared/api/client';
import { studentsApi } from './students.api';
import { classesApi, type ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { Student, InvoiceItem, Grade, formatVND, formatDate } from '../../shared/types';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton, TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './Students.css';

interface Detail {
  student: Student;
  classes: { id: number; name: string; enroll_status: string; enrolled_at: string }[];
  invoices: InvoiceItem[];
}

export function StudentDetail() {
  const { t } = useTranslation(['students', 'common']);
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const d = await http.get<Detail>(`/students/${id}`);
        setData(d);
      } catch (err) {
        toast(err instanceof Error ? err.message : t('detail.loadError'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, toast, t]);

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
        <EmptyState icon="user" title={t('detail.notFoundTitle')} desc={t('detail.notFoundDesc')} />
      </div>
    );
  const { student } = data;

  return (
    <div className="page">
      <Link className="link back-link" to="/app/students">
        <Icon name="arrow-right" size={14} className="flip-x" />
        {t('detail.back')}
      </Link>
      <div className="profile-head">
        <div className="profile-avatar">{student.name.charAt(0).toUpperCase()}</div>
        <div className="profile-meta">
          <h1 className="page-title">
            {student.name} <span className="muted mono">({student.code})</span>
          </h1>
          <div className="profile-badges">
            <span className={`badge badge-${student.status}`}>{t(`status.${student.status}`)}</span>
          </div>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="section-head">
            <h3>{t('detail.personalInfo')}</h3>
          </div>
          <dl className="kv">
            <dt>{t('detail.phone')}</dt>
            <dd>{student.phone || '-'}</dd>
            <dt>{t('detail.email')}</dt>
            <dd>{student.email || '-'}</dd>
            <dt>{t('detail.dob')}</dt>
            <dd>{formatDate(student.dob)}</dd>
            <dt>{t('detail.address')}</dt>
            <dd>{student.address || '-'}</dd>
            <dt>{t('detail.note')}</dt>
            <dd>{student.note || '-'}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="section-head">
            <h3>{t('detail.classes')}</h3>
          </div>
          {data.classes.length === 0 ? (
            <EmptyState icon="book" title={t('detail.noClasses')} />
          ) : (
            <ul className="list">
              {data.classes.map((c) => (
                <li key={c.id} className="list-item">
                  <Link className="link" to={`/app/classes/${c.id}`}>
                    {c.name}
                  </Link>
                  <span className="muted">{t('detail.fromDate', { date: formatDate(c.enrolled_at) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="section-head">
          <h3>{t('detail.invoices')}</h3>
        </div>
        {data.invoices.length === 0 ? (
          <EmptyState icon="banknote" title={t('detail.noInvoices')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('detail.invoiceTable.class')}</th>
                  <th scope="col">{t('detail.invoiceTable.amount')}</th>
                  <th scope="col">{t('detail.invoiceTable.paid')}</th>
                  <th scope="col">{t('detail.invoiceTable.dueDate')}</th>
                  <th scope="col">{t('detail.invoiceTable.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.class_name || '-'}</td>
                    <td className="num">{formatVND(inv.amount)}</td>
                    <td className="num">{formatVND(inv.paid || 0)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>
                      <span className={`badge badge-${inv.status}`}>{t(`invoiceStatus.${inv.status}`)}</span>
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
  const { t } = useTranslation(['students', 'common']);
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
      toast(err instanceof Error ? err.message : t('detail.grades.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [studentId, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await http.del(`/grades/${deleting.id}`);
      toast(t('detail.grades.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h3>{t('detail.grades.title')}</h3>
        <button className="btn btn-sm btn-primary btn-inline" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={13} />
          {t('detail.grades.add')}
        </button>
      </div>
      {loading ? (
        <TableSkeleton cols={6} />
      ) : grades.length === 0 ? (
        <EmptyState icon="cap" title={t('detail.grades.emptyTitle')} desc={t('detail.grades.emptyDesc')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('detail.grades.table.exam')}</th>
                <th scope="col">{t('detail.grades.table.class')}</th>
                <th scope="col">{t('detail.grades.table.score')}</th>
                <th scope="col">{t('detail.grades.table.comment')}</th>
                <th scope="col">{t('detail.grades.table.date')}</th>
                <th scope="col" className="th-right">{t('detail.grades.table.actions')}</th>
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
                  <td>{formatDate(g.created_at)}</td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-inline btn-danger-ghost" onClick={() => setDeleting(g)}>
                      <Icon name="trash" size={13} />
                      {t('actions.delete', { ns: 'common' })}
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
          title={t('detail.grades.deleteTitle')}
          message={t('detail.grades.deleteMessage', {
            title: deleting.title,
            score: deleting.score,
            max: deleting.max_score,
          })}
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
  const { t } = useTranslation(['students', 'common']);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('10');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // HIGH-2: GET /classes trả envelope {data, pagination}, phải lấy .data trước khi filter
    classesApi
      .list({ limit: 100 })
      .then((r) => setClasses(r.data.filter((x) => x.status === 'active')))
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
      toast(t('detail.grades.saved'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('detail.grades.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('detail.grades.formTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('detail.grades.form.class')}>
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{t('detail.grades.form.noClass')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('detail.grades.form.examName')}>
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label={t('detail.grades.form.score')}>
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
          <Field label={t('detail.grades.form.maxScore')}>
            <input
              className="text-input"
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </Field>
          <Field label={t('detail.grades.form.comment')} span>
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
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
