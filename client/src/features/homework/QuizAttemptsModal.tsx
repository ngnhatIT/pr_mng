import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type QuizAttemptRow, type QuizEssayInfo } from './homework.api';
import { HomeworkItem, formatDate } from '../../shared/types';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';
import { EssayGradeModal } from './EssayGradeModal';

export function QuizAttemptsModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
  const [rows, setRows] = useState<QuizAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // YC2: quiz có câu essay + rubric mới hiện nút chấm tự luận
  const [essayInfo, setEssayInfo] = useState<QuizEssayInfo | null>(null);
  const [grading, setGrading] = useState<{ studentId: number; studentName: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [attempts, essay] = await Promise.all([
        homeworkApi.getQuizAttempts(homework.id),
        homeworkApi.getQuizEssayInfo(homework.id).catch(() => null),
      ]);
      setRows(attempts);
      setEssayInfo(essay);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [homework.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canGradeEssay =
    !!essayInfo && essayInfo.essay_questions.length > 0 && !!essayInfo.rubric;

  const avg =
    rows.length > 0
      ? rows.reduce((s, r) => s + (r.max_score > 0 ? (r.score / r.max_score) * 100 : 0), 0) / rows.length
      : 0;

  // Chấm theo học viên (không theo lượt làm) - chỉ hiện nút ở dòng đầu tiên của mỗi học viên
  const seenStudents = new Set<number>();

  return (
    <Modal title={t('attempts.title', { title: homework.title })} onClose={onClose} wide>
      <div className="muted hw-action-icon attempts-summary">
        <Icon name="users" size={14} />
        <span>
          <strong className="num">{rows.length}</strong> {t('attempts.attempts', { count: rows.length })}
        </span>
        <span aria-hidden="true">·</span>
        <Icon name="star" size={14} />
        <span>{t('attempts.avgScore', { avg: avg.toFixed(1) })}</span>
      </div>
      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <EmptyState
          icon="alert"
          title={t('states.loadError', { ns: 'common' })}
          action={
            <button className="btn btn-secondary btn-inline" onClick={() => void load()}>
              <Icon name="rotate" size={14} /> {t('actions.retry', { ns: 'common' })}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon="file" title={t('attempts.empty')} desc={t('attempts.emptyDesc')} />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('attempts.col.student')}</th>
                <th scope="col" className="th-right">
                  {t('attempts.col.score')}
                </th>
                <th scope="col" className="th-right">
                  {t('attempts.col.rate')}
                </th>
                <th scope="col" className="th-right">
                  {t('attempts.col.submittedAt')}
                </th>
                {canGradeEssay && <th scope="col">{t('essay.gradeCol')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.max_score > 0 ? (r.score / r.max_score) * 100 : 0;
                // Nút chấm chỉ ở dòng đầu tiên của mỗi học viên (chấm theo HV, không theo lượt)
                const firstOfStudent = !seenStudents.has(r.student_id);
                seenStudents.add(r.student_id);
                return (
                  <tr key={r.id}>
                    <td className="attempts-student">{r.student_name}</td>
                    <td className="td-right">
                      <span className="num attempts-score">
                        {r.score}/{r.max_score}
                      </span>
                    </td>
                    <td className="td-right">
                      <span
                        className={`badge ${pct >= 80 ? 'badge-paid' : pct >= 50 ? 'badge-late' : 'badge-overdue'}`}
                      >
                        {pct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="td-right muted">{formatDate(r.submitted_at)}</td>
                    {canGradeEssay && (
                      <td>
                        {firstOfStudent && (
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              setGrading({ studentId: r.student_id, studentName: r.student_name })
                            }
                          >
                            {t('essay.gradeButton')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {grading && (
        <EssayGradeModal
          homeworkId={homework.id}
          title={homework.title}
          studentId={grading.studentId}
          studentName={grading.studentName}
          maxScore={homework.max_score ?? null}
          onClose={() => setGrading(null)}
        />
      )}
    </Modal>
  );
}
