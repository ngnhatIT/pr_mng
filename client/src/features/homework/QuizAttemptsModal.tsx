import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type QuizAttemptRow } from './homework.api';
import { HomeworkItem, formatDate } from '../../shared/types';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';

export function QuizAttemptsModal({ homework, onClose }: { homework: HomeworkItem; onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
  const toast = useToast();
  const [rows, setRows] = useState<QuizAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    homeworkApi
      .getQuizAttempts(homework.id)
      .then(setRows)
      .catch((err: Error) => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [homework.id, toast]);

  const avg =
    rows.length > 0
      ? rows.reduce((s, r) => s + (r.max_score > 0 ? (r.score / r.max_score) * 100 : 0), 0) / rows.length
      : 0;

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
      ) : rows.length === 0 ? (
        <EmptyState icon="file" title={t('attempts.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <th scope="col"ead>
              <tr>
                <th scope="col">{t('attempts.col.student')}</th>
                <th scope="col" className="th-right">{t('attempts.col.score')}</th>
                <th scope="col" className="th-right">{t('attempts.col.rate')}</th>
                <th scope="col" className="th-right">{t('attempts.col.submittedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.max_score > 0 ? (r.score / r.max_score) * 100 : 0;
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
