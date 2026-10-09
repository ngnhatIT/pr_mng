import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type HomeworkAnalytics } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/icons';

/** Phân tích bài tập: tỷ lệ hoàn thành & điểm TB theo lớp. */
export function AnalyticsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
  const [data, setData] = useState<HomeworkAnalytics | null>(null);

  useEffect(() => {
    void homeworkApi
      .analytics()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <Modal title={t('analytics.title')} onClose={onClose} wide>
      {!data ? (
        <p className="muted">{t('actions.loading', { ns: 'common' })}</p>
      ) : (
        <div className="hw-analytics">
          <h4 className="section-title hw-action-icon">
            <Icon name="users" size={15} /> {t('analytics.byClass')}
          </h4>
          {data.byClass.length === 0 ? (
            <p className="muted">{t('analytics.noData')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('analytics.col.class')}</th>
                  <th className="th-center">{t('analytics.col.published')}</th>
                  <th className="th-center">{t('analytics.col.avgCompletion')}</th>
                  <th className="th-center">{t('analytics.col.avgScore')}</th>
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
      )}
    </Modal>
  );
}
