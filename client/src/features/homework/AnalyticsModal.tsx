import { useEffect, useState } from 'react';
import { homeworkApi, type HomeworkAnalytics } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/icons';

/** Phân tích bài tập: tỷ lệ hoàn thành & điểm TB theo lớp. */
export function AnalyticsModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<HomeworkAnalytics | null>(null);

  useEffect(() => {
    homeworkApi.analytics().then(setData);
  }, []);

  return (
    <Modal title="Phân tích bài tập" onClose={onClose} wide>
      {!data ? (
        <p className="muted">Đang tải...</p>
      ) : (
        <div className="hw-analytics">
          <h4 className="section-title hw-action-icon">
            <Icon name="users" size={15} /> Theo lớp
          </h4>
          {data.byClass.length === 0 ? (
            <p className="muted">Chưa có dữ liệu.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Lớp</th>
                  <th style={{ textAlign: 'center' }}>Bài đã đăng</th>
                  <th style={{ textAlign: 'center' }}>Hoàn thành TB</th>
                  <th style={{ textAlign: 'center' }}>Điểm TB</th>
                </tr>
              </thead>
              <tbody>
                {data.byClass.map((c) => (
                  <tr key={c.class_id}>
                    <td>{c.class_name}</td>
                    <td style={{ textAlign: 'center' }}>{c.total}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${c.avg_completion >= 0.8 ? 'badge-done' : c.avg_completion >= 0.5 ? 'badge-pending' : 'badge-overdue'}`}>
                        {Math.round(c.avg_completion * 100)}%
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {c.avg_score !== null ? c.avg_score.toFixed(1) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4 className="section-title hw-action-icon" style={{ marginTop: 20 }}>
            <Icon name="clock" size={15} /> Bài mới nhất
          </h4>
          {data.recent.length === 0 ? (
            <p className="muted">Chưa có bài nào.</p>
          ) : (
            <div className="bank-list">
              {data.recent.map((r) => (
                <div key={r.id} className="bank-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{r.class_name}</div>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.round(r.completion_rate)}%` }} />
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>{Math.round(r.completion_rate)}%</span>
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
