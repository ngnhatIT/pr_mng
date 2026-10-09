import { useEffect, useState } from 'react';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { parentApi, type Submission } from './parent.api';
import { formatDateTime } from '../../shared/types';
import { getToken } from '../../shared/api/client';
import { Icon } from '../../shared/components/icons';
import type { HomeworkItem } from '../../shared/types';
import './parent.css';

/** Phụ huynh xem lịch sử bài đã nộp của con. */
export function MySubmissionsModal({
  homework,
  studentId,
  onClose,
}: {
  homework: HomeworkItem;
  studentId: number;
  onClose: () => void;
}) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    parentApi
      .getSubmissions(homework.id, studentId)
      .then(setSubs)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [homework.id, studentId]);

  const fileUrl = (url: string | null) => {
    if (!url) return '';
    const token = getToken();
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  };

  return (
    <Modal title={`Bài đã nộp - ${homework.title}`} onClose={onClose}>
      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : subs.length === 0 ? (
        <EmptyState icon="file" title="Chưa nộp bài nào" desc="Bấm nút Nộp bài để gửi bài làm của con." />
      ) : (
        <div className="submission-list">
          {subs.map((s) => (
            <div key={s.id} className="submission-item">
              <div style={{ flex: 1 }}>
                <div className="muted" style={{ fontSize: 13 }}>
                  Nộp lúc {formatDateTime(s.submitted_at)}
                </div>
                {s.note && <div style={{ marginTop: 6 }}>{s.note}</div>}
                {s.file_url && (
                  <div style={{ marginTop: 6 }}>
                    <a className="link file-link" href={fileUrl(s.file_url)} target="_blank" rel="noreferrer">
                      <Icon name="paperclip" size={14} />
                      {s.file_name || 'Xem file'}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
