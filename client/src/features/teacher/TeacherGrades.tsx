import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { teacherApi } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { ClassItem } from '../classes/classes.api';
import { Grade, formatDate } from '../../shared/types';
import './TeacherGrades.css';

export function TeacherGrades() {
  const { t } = useTranslation(['teacher', 'common']);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<{ id: number; name: string; code: string }[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Grade | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  useEffect(() => {
    teacherApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const loadGrades = useCallback(async () => {
    if (!studentId) {
      setGrades([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    try {
      const res = await teacherApi.listGrades(studentId, classId, { page });
      setGrades(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grades.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [studentId, classId, page, toast, t]);

  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  const pickClass = async (cid: string) => {
    setClassId(cid);
    setStudentId('');
    setStudents([]);
    setGrades([]);
    setPage(1);
    if (!cid) return;
    try {
      const d = await teacherApi.classStudents(cid);
      setStudents(d.students);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grades.studentsError'), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await teacherApi.deleteGrade(deleting.id);
      toast(t('grades.deleted'), 'success');
      setDeleting(null);
      void loadGrades();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grades.deleteFail'), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('grades.title')}
        desc={t('grades.desc')}
        actions={
          studentId ? (
            <button className="btn btn-primary grades-add-btn" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={16} />
              {t('grades.add')}
            </button>
          ) : undefined
        }
      />

      <div className="toolbar grades-toolbar">
        <select
          aria-label="Chọn lớp"
          className="text-input"
          value={classId}
          onChange={(e) => void pickClass(e.target.value)}
        >
          <option value="">{t('grades.selectClass')}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Chọn môn"
          className="text-input"
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setPage(1);
          }}
          disabled={!classId}
        >
          <option value="">{t('grades.selectStudent')}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : !studentId ? (
        <EmptyState icon="cap" title={t('grades.noStudentTitle')} desc={t('grades.noStudentDesc')} />
      ) : grades.length === 0 ? (
        <EmptyState icon="file" title={t('grades.noGradesTitle')} desc={t('grades.noGradesDesc')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <th scope="col"ead>
              <tr>
                <th scope="col">{t('grades.thTest')}</th>
                <th scope="col">{t('grades.thScore')}</th>
                <th scope="col">{t('grades.thComment')}</th>
                <th scope="col">{t('grades.thDate')}</th>
                <th scope="col" className="th-right">{t('grades.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>
                    <span
                      className={`score-pill ${
                        g.max_score > 0 && g.score / g.max_score >= 0.5 ? 'score-pass' : 'score-fail'
                      }`}
                    >
                      {g.score}/{g.max_score}
                    </span>
                  </td>
                  <td>{g.comment || '-'}</td>
                  <td>{formatDate(g.created_at)}</td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(g)}>
                      {t('actions.delete', { ns: 'common' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {showForm && studentId && (
        <GradeFormModal
          studentId={Number(studentId)}
          classId={classId ? Number(classId) : null}
          onClose={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            void loadGrades();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('grades.deleteTitle')}
          message={t('grades.deleteMessage', {
            title: deleting.title,
            score: deleting.score,
            max: deleting.max_score,
          })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function GradeFormModal({
  studentId,
  classId,
  onClose,
  onDone,
}: {
  studentId: number;
  classId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['teacher', 'common']);
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('10');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await teacherApi.createGrade({
        student_id: studentId,
        class_id: classId,
        title,
        score: Number(score),
        max_score: Number(maxScore) || 10,
        comment: comment || null,
      });
      toast(t('grades.saved'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grades.saveFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('grades.formTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('grades.formTestName')} span>
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label={t('grades.formScore')}>
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
          <Field label={t('grades.formMaxScore')}>
            <input
              className="text-input"
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
            />
          </Field>
          <Field label={t('grades.formComment')} span>
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
