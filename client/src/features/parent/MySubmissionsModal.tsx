import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { parentApi, type Submission } from './parent.api';
import { formatDateTime } from '../../shared/types';
import { useSecureFileUrl } from '../../shared/components/SecureFile';
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
  const { t } = useTranslation(['parent', 'common']);
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

  return (
    <Modal title={t('submissions.title', { title: homework.title })} onClose={onClose}>
      {loading ? (
        <p className="muted">{t('states.loading', { ns: 'common' })}</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : subs.length === 0 ? (
        <EmptyState icon="file" title={t('submissions.emptyTitle')} desc={t('submissions.emptyDesc')} />
      ) : (
        <div className="submission-list">
          {subs.map((s) => (
            <MySubmissionRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Một dòng bài nộp: tải file qua Authorization header (blob URL), không gắn JWT vào URL. */
function MySubmissionRow({ s }: { s: Submission }) {
  const { t } = useTranslation(['parent', 'common']);
  const fileUrl = useSecureFileUrl(s.file_url);
  return (
    <div className="submission-item">
      <div style={{ flex: 1 }}>
        <div className="muted-sm">
          {t('submissions.submittedAt', { time: formatDateTime(s.submitted_at) })}
        </div>
        {s.note && <div style={{ marginTop: 6 }}>{s.note}</div>}
        {s.file_url && fileUrl && (
          <div style={{ marginTop: 6 }}>
            <a className="link file-link" href={fileUrl} target="_blank" rel="noreferrer">
              <Icon name="paperclip" size={14} />
              {s.file_name || t('submissions.viewFile')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
