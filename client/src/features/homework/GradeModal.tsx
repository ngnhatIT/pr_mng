import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type HomeworkScoreRow, type Rubric } from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';

export function GradeModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [rows, setRows] = useState<HomeworkScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const rowStatus = (r: HomeworkScoreRow) => {
    if (r.score !== null) return <span className="badge badge-paid">{t('grade.status.graded')}</span>;
    if (r.completed) return <span className="badge badge-upcoming">{t('grade.status.submitted')}</span>;
    return <span className="badge badge-general">{t('grade.status.pending')}</span>;
  };

  const load = async (keepSelection: boolean) => {
    setLoading(true);
    try {
      const data = await homeworkApi.getScores(homework.id);
      setRows(data);
      setSelected((prev) => {
        if (keepSelection && prev !== null && data.some((r) => r.student_id === prev)) return prev;
        const next = data.find((r) => r.score === null) ?? data[0];
        return next ? next.student_id : null;
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grade.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    if (homework.rubric_id) {
      homeworkApi
        .listRubrics()
        .then((rs) => {
          const r = rs.find((x) => x.id === homework.rubric_id);
          if (r) setRubric(r);
        })
        .catch(() => {});
    }
  }, [homework.id]);

  const selectRow = (row: HomeworkScoreRow) => {
    setSelected(row.student_id);
  };

  // Đồng bộ form chấm theo học viên đang chọn (kể cả sau khi tải lại)
  useEffect(() => {
    const row = rows.find((r) => r.student_id === selected);
    if (row) {
      setScore(row.score?.toString() ?? '');
      setFeedback(row.feedback ?? '');
    }
  }, [selected, rows]);

  const save = async (studentId: number) => {
    setBusy(true);
    try {
      const s = score === '' ? null : Number(score);
      if (s !== null && (!Number.isFinite(s) || s < 0)) {
        toast(t('grade.toast.invalidScore'), 'error');
        return;
      }
      if (homework.max_score != null && s !== null && s > homework.max_score) {
        toast(t('grade.toast.overMax', { max: homework.max_score }), 'error');
        return;
      }
      await homeworkApi.grade(homework.id, studentId, s, feedback);
      toast(t('grade.toast.saved'), 'success');
      void load(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('grade.toast.saveFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const graded = rows.filter((r) => r.score !== null).length;
  const pct = rows.length > 0 ? Math.round((graded / rows.length) * 100) : 0;
  const current = rows.find((r) => r.student_id === selected);

  return (
    <Modal title={t('grade.title', { title: homework.title })} onClose={onClose} wide>
      {rubric && (
        <div className="rubric-banner">
          <strong>{t('grade.rubric', { name: rubric.name })}</strong>
          <div className="muted grade-sub">
            {rubric.criteria
              .map((c) => t('form.rubricOption', { name: c.name, score: c.max_score }))
              .join(', ')}
          </div>
        </div>
      )}
      <div className="grade-progress">
        <span className="muted grade-progress-label">
          {t('grade.progressDone')}{' '}
          <strong className="num">
            {graded}/{rows.length}
          </strong>
          {homework.max_score != null && ` · ${t('grade.scale', { max: homework.max_score })}`}
        </span>
        <div className="hw-progress-track" aria-hidden="true">
          <div className="hw-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title={t('grade.empty')} />
      ) : (
        <div className="grade-layout">
          {/* Vùng trái: danh sách học viên */}
          <div className="grade-list" role="listbox" aria-label={t('grade.studentList')}>
            {rows.map((r) => (
              <button
                key={r.student_id}
                type="button"
                className={`grade-row ${selected === r.student_id ? 'selected' : ''}`}
                onClick={() => selectRow(r)}
                role="option"
                aria-selected={selected === r.student_id}
              >
                <span className="grade-name">{r.student_name}</span>
                {rowStatus(r)}
                <span className="num">{r.score !== null ? r.score : '-'}</span>
              </button>
            ))}
          </div>

          {/* Vùng phải: form chấm điểm */}
          <div className="grade-panel">
            {current ? (
              <>
                <div className="grade-panel-head">
                  <span className="grade-name">{current.student_name}</span>
                  {rowStatus(current)}
                </div>
                <div className="grade-score-row">
                  <input
                    className="text-input grade-score-input"
                    type="number"
                    min="0"
                    step="0.5"
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    placeholder={t('grade.score')}
                    aria-label={t('grade.score')}
                  />
                  {homework.max_score != null && <span className="muted">/ {homework.max_score}</span>}
                </div>
                <textarea
                  className="text-input"
                  rows={3}
                  placeholder={t('grade.feedbackPh')}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  aria-label={t('grade.feedback')}
                />
                <div className="modal-actions grade-actions">
                  <button
                    className="btn btn-primary hw-action-icon"
                    disabled={busy}
                    onClick={() => void save(current.student_id)}
                  >
                    <Icon name="check" size={15} />{' '}
                    {busy ? t('actions.saving', { ns: 'common' }) : t('grade.saveScore')}
                  </button>
                </div>
              </>
            ) : (
              <EmptyState icon="pencil" title={t('grade.pickStudent')} desc={t('grade.pickStudentDesc')} />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
