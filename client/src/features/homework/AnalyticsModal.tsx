import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type HomeworkAnalytics } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';

/** Phân tích bài tập: tỷ lệ hoàn thành & điểm TB theo lớp. */
export function AnalyticsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
  const [data, setData] = useState<HomeworkAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await homeworkApi.analytics());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal title={t('analytics.title')} onClose={onClose} wide>
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
      ) : data ? (
        <div className="hw-analytics">
          <h4 className="section-title hw-action-icon">
            <Icon name="users" size={15} /> {t('analytics.byClass')}
          </h4>
          {data.byClass.length === 0 ? (
            <p className="muted">{t('analytics.noData')}</p>
          ) : (
            <div className="table-wrap sticky">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('analytics.col.class')}</th>
                    <th scope="col" className="th-center">
                      {t('analytics.col.published')}
                    </th>
                    <th scope="col" className="th-center">
                      {t('analytics.col.avgCompletion')}
                    </th>
                    <th scope="col" className="th-center">
                      {t('analytics.col.avgScore')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byClass.map((c) => (
                    <tr key={c.class_id}>
                      <td>{c.class_name}</td>
                      <td className="td-center">{c.total}</td>
                      <td className="td-center">
                        <span
                          className={`badge ${c.avg_completion >= 0.8 ? 'badge-done' : c.avg_completion >= 0.5 ? 'badge-pending' : 'badge-overdue'}`}
                        >
                          {Math.round(c.avg_completion * 100)}%
                        </span>
                      </td>
                      <td className="td-center">{c.avg_score !== null ? c.avg_score.toFixed(1) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4 className="section-title hw-action-icon analytics-recent-head">
            <Icon name="clock" size={15} /> {t('analytics.recent')}
          </h4>
          {data.recent.length === 0 ? (
            <p className="muted">{t('analytics.noRecent')}</p>
          ) : (
            <div className="bank-list">
              {data.recent.map((r) => (
                <div key={r.id} className="bank-item">
                  <div className="bank-item-body">
                    <div className="analytics-item-title">{r.title}</div>
                    <div className="muted analytics-item-sub">{r.class_name}</div>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.round(r.completion_rate)}%` }} />
                    </div>
                    <span className="muted analytics-item-sub">{Math.round(r.completion_rate)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
