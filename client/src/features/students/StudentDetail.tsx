import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { studentsApi, type StudentDetail as Detail } from './students.api';
import { classesApi, type ClassItem } from '../classes/classes.api';
import { useMyPermissions } from '../system/roles.api';
import { fetchAllPages } from '../../shared/components/Pagination';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { useLoad } from '../../shared/hooks/useLoad';
import { Grade, formatVND, formatDate } from '../../shared/types';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { Skeleton, TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import './Students.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

export function StudentDetail() {
  const { t } = useTranslation(['students', 'common']);
  const { id } = useParams<{ id: string }>();
  // UX-5: đổi :id nhanh thì response học viên cũ về muộn bị bỏ qua
  const { data, loading, error: loadErr, reload } = useLoad<Detail>(() => studentsApi.get(Number(id)), [id]);
  // ADM-22: phân biệt 404 với lỗi tải (mạng/timeout) để hiện nút Thử lại
  const error = loadErr ? ((loadErr as { code?: string }).code === 'NOT_FOUND' ? 'notFound' : 'load') : null;

  // Đang tải (kể cả đổi :id / thử lại) -> skeleton, không hiện dữ liệu học viên cũ
  if (loading)
    return (
      <div className="page">
        <div className="profile-head" aria-hidden="true">
          <Skeleton width={64} height={64} radius={18} />
          <div style={{ flex: 1 }}>
            <Skeleton width="40%" height={24} radius={8} />
            <div style={{ marginTop: 8 }}>
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
  if (error === 'load')
    return (
      <div className="page">
        <EmptyState
          icon="alert"
          title={t('detail.loadError')}
          action={
            <button type="button" className="btn btn-primary btn-inline" onClick={reload}>
              <Icon name="rotate" size={14} />
              {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <EmptyState
          icon="user"
          title={t('detail.notFoundTitle')}
          desc={t('detail.notFoundDesc')}
          action={
            <Link className="btn btn-primary btn-inline" to="/app/students">
              {t('actions.back', { ns: 'common' })}
            </Link>
          }
        />
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
        <div className="profile-avatar" aria-hidden="true">
          <Icon name="user" size={28} />
        </div>
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
            <dd>{student.phone || <EmptyCell />}</dd>
            <dt>{t('detail.email')}</dt>
            <dd>{student.email || <EmptyCell />}</dd>
            <dt>{t('detail.dob')}</dt>
            <dd>{formatDate(student.dob)}</dd>
            <dt>{t('detail.address')}</dt>
            <dd>{student.address || <EmptyCell />}</dd>
            <dt>{t('detail.note')}</dt>
            <dd>{student.note || <EmptyCell />}</dd>
          </dl>
        </section>

        <section className="card">
          <div className="section-head">
            <h3>{t('detail.classes')}</h3>
          </div>
          {data.classes.length === 0 ? (
            <EmptyState
              icon="book"
              title={t('detail.noClasses')}
              desc={t('detail.noClassesDesc')}
              action={
                <Link className="btn btn-primary btn-sm" to={`/app/classes?enrollStudent=${id}`}>
                  {t('detail.noClassesAction')}
                </Link>
              }
            />
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
          <EmptyState
            icon="banknote"
            title={t('detail.noInvoices')}
            desc={t('detail.noInvoicesDesc')}
            action={
              <Link className="btn btn-primary btn-sm" to="/app/tuition">
                {t('detail.noInvoicesAction')}
              </Link>
            }
          />
        ) : (
          <div className="table-wrap sticky">
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
                    <td>{inv.class_name || <EmptyCell />}</td>
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
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Grade | null>(null);
  const toast = useToast();
  const canManage = useMyPermissions().has('grades.manage');

  const {
    data,
    loading,
    error,
    reload: load,
  } = useLoad<Grade[]>(() => fetchAllPages((p) => studentsApi.listGrades(studentId, p)), [studentId]);
  const grades = data ?? [];
  useEffect(() => {
    if (error) toastApiError(toast, error, t('detail.grades.loadError'));
  }, [error, toast]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await studentsApi.deleteGrade(deleting.id);
      toast(t('detail.grades.deleted'), 'success');
      setDeleting(null);
      load();
    } catch (err) {
      toastApiError(toast, err, t('states.deleteError', { ns: 'common' }));
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h3>{t('detail.grades.title')}</h3>
        {canManage && (
          <button className="btn btn-sm btn-primary btn-inline" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {t('detail.grades.add')}
          </button>
        )}
      </div>
      {loading && !data ? (
        <TableSkeleton cols={6} />
      ) : error && !data ? (
        <LoadError onRetry={load} title={t('detail.grades.loadError')} />
      ) : grades.length === 0 ? (
        <EmptyState icon="cap" title={t('detail.grades.emptyTitle')} desc={t('detail.grades.emptyDesc')} />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('detail.grades.table.exam')}</th>
                <th scope="col">{t('detail.grades.table.class')}</th>
                <th scope="col">{t('detail.grades.table.score')}</th>
                <th scope="col">{t('detail.grades.table.comment')}</th>
                <th scope="col">{t('detail.grades.table.date')}</th>
                <th scope="col" className="th-right">
                  {t('detail.grades.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>{g.class_name || <EmptyCell />}</td>
                  <td className="num">
                    <strong>
                      {g.score}/{g.max_score}
                    </strong>
                  </td>
                  <td>{g.comment || <EmptyCell />}</td>
                  <td>{formatDate(g.created_at)}</td>
                  <td className="td-right">
                    {canManage && (
                      <span className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-ghost"
                          onClick={() => setDeleting(g)}
                        >
                          <Icon name="trash" size={15} />
                          {t('actions.delete', { ns: 'common' })}
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
      {showForm && (
        <StudentGradeFormModal
          studentId={studentId}
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            load();
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
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2)
  const { errors, refFor, show, clear } = useFieldErrors<'score'>();

  useEffect(() => {
    // ADM-6: server chặn 100/trang -> tải đủ mọi trang
    fetchAllPages((p) => classesApi.list('', p))
      .then((all) => setClasses(all.filter((x) => x.status === 'active')))
      .catch((err: unknown) => toastApiError(toast, err, t('states.loadError', { ns: 'common' })));
  }, [toast, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Điểm không được vượt quá thang điểm: lỗi inline dưới ô điểm, giữ lại dữ liệu đã nhập
    const max = Number(maxScore) || 10;
    const errs: Record<string, string> = {};
    if (score.trim() !== '' && Number.isFinite(Number(score)) && Number(score) > max)
      errs.score = t('detail.grades.scoreTooHigh', { max });
    if (!show(errs)) return;
    setBusy(true);
    try {
      await studentsApi.createGrade({
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
      toastApiError(toast, err, t('detail.grades.saveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('detail.grades.formTitle')}
      onClose={onClose}
      dirty={!!(classId || title || score || comment) || maxScore !== '10'}
    >
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
            {/* B-6: Lớp ở trước là tùy chọn -> focus thẳng tên bài kiểm tra */}
            <input
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={t('detail.grades.form.score')} error={errors.score}>
            <input
              ref={refFor('score')}
              className="text-input"
              type="number"
              step="0.25"
              min={0}
              value={score}
              onChange={(e) => {
                setScore(e.target.value);
                clear('score');
              }}
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
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
