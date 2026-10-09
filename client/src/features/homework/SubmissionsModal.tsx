import { useEffect, useState } from 'react';
import { homeworkApi, type Submission } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { formatDateTime } from '../../shared/types';
import { getToken } from '../../shared/api/client';

/** Giáo viên xem bài nộp của học viên (ảnh/file + ghi chú). */
export function SubmissionsModal({ homeworkId, title, onClose }: { homeworkId: number; title: string; onClose: () => void }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    homeworkApi
      .getSubmissions(homeworkId)
      .then(setSubs)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [homeworkId]);

  const isImage = (url: string | null) => !!url && /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  const fileUrl = (url: string | null) => {
    if (!url) return '';
    const token = getToken();
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  };

  return (
    <Modal title={`Bài nộp — ${title}`} onClose={onClose} wide>
      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : subs.length === 0 ? (
        <EmptyState icon="file" title="Chưa có bài nộp" desc="Phụ huynh nộp bài qua cổng phụ huynh." />
      ) : (
        <div className="submission-list">
          {subs.map((s) => (
            <div key={s.id} className="submission-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{s.student_name}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Nộp lúc {formatDateTime(s.submitted_at)}
                </div>
                {s.note && <div style={{ marginTop: 6 }}>{s.note}</div>}
                {s.file_url && !isImage(s.file_url) && (
                  <div style={{ marginTop: 6 }}>
                    <a className="link" href={fileUrl(s.file_url)} target="_blank" rel="noreferrer">
                      📎 {s.file_name || 'Tải file'}
                    </a>
                  </div>
                )}
              </div>
              {s.file_url && isImage(s.file_url) && (
                <a href={fileUrl(s.file_url)} target="_blank" rel="noreferrer">
                  <img src={fileUrl(s.file_url)} alt={s.file_name || ''} className="submission-thumb" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
