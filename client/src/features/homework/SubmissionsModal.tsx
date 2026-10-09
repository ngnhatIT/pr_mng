import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type Submission } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';
import { formatDateTime } from '../../shared/types';
import { getToken } from '../../shared/api/client';

/** Giáo viên xem bài nộp của học viên (ảnh/file + ghi chú). */
export function SubmissionsModal({ homeworkId, title, onClose }: { homeworkId: number; title: string; onClose: () => void }) {
  const { t } = useTranslation(['homework', 'common']);
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
    <Modal title={t('submissions.title', { title })} onClose={onClose} wide>
      {loading ? (
        <p className="muted">{t('actions.loading', { ns: 'common' })}</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : subs.length === 0 ? (
        <EmptyState icon="file" title={t('submissions.empty')} desc={t('submissions.emptyDesc')} />
      ) : (
        <>
          <div className="muted submissions-count">
            {t('submissions.count', { count: subs.length })}
          </div>
          <div className="submission-list">
            {subs.map((s) => (
              <div key={s.id} className="submission-item">
                <div className="submission-body">
                  <div className="submission-student">{s.student_name}</div>
                  <div className="muted submission-time">
                    {t('submissions.submittedAt', { time: formatDateTime(s.submitted_at) })}
                  </div>
                  {s.note && <div className="submission-note">{s.note}</div>}
                  {s.file_url && !isImage(s.file_url) && (
                    <a className="link submission-file-link" href={fileUrl(s.file_url)} target="_blank" rel="noreferrer">
                      <Icon name="paperclip" size={14} /> {s.file_name || t('submissions.downloadFile')}
                    </a>
                  )}
                </div>
                {s.file_url && isImage(s.file_url) && (
                  <a href={fileUrl(s.file_url)} target="_blank" rel="noreferrer" title={t('submissions.viewLarge')}>
                    <img src={fileUrl(s.file_url)} alt={s.file_name || t('submissions.imageAlt')} className="submission-thumb" loading="lazy" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
