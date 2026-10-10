import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, type Submission } from './homework.api';
import { Modal } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { Icon } from '../../shared/components/icons';
import { formatDateTime } from '../../shared/types';
import { useSecureFileUrl } from '../../shared/components/SecureFile';

/** Giáo viên xem bài nộp của học viên (ảnh/file + ghi chú). */
export function SubmissionsModal({
  homeworkId,
  title,
  closeDate,
  onClose,
}: {
  homeworkId: number;
  title: string;
  /** Hạn khóa nộp (YYYY-MM-DD). Chỉ hiện badge trễ khi có đủ dữ liệu. */
  closeDate: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    homeworkApi
      .getSubmissions(homeworkId)
      .then((res) => setSubs(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [homeworkId]);

  const isImage = (url: string | null) => !!url && /\.(jpg|jpeg|png|gif|webp)$/i.test(url);

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
          <div className="muted submissions-count">{t('submissions.count', { count: subs.length })}</div>
          <div className="submission-list">
            {subs.map((s) => (
              <SubmissionRow key={s.id} s={s} isImage={isImage(s.file_url)} closeDate={closeDate} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Một dòng bài nộp: tải file qua Authorization header (blob URL), không gắn JWT vào URL. */
function SubmissionRow({ s, isImage, closeDate }: { s: Submission; isImage: boolean; closeDate: string | null }) {
  const { t } = useTranslation(['homework', 'common']);
  const fileUrl = useSecureFileUrl(s.file_url);
  // Nộp sau close_date (so sánh ngày, giờ VN) mới là trễ; thiếu dữ liệu thì không hiện
  const isLate = !!closeDate && !!s.submitted_at && s.submitted_at.slice(0, 10) > closeDate;
  return (
    <div className="submission-item">
      <div className="submission-body">
        <div className="submission-student">{s.student_name}</div>
        <div className="muted submission-time">
          {t('submissions.submittedAt', { time: formatDateTime(s.submitted_at) })}
          {isLate && (
            <>
              {' '}
              <span className="badge badge-late">{t('submissions.late')}</span>
            </>
          )}
        </div>
        {s.note && <div className="submission-note">{s.note}</div>}
        {s.file_url && !isImage && fileUrl && (
          <a className="link submission-file-link" href={fileUrl} target="_blank" rel="noreferrer">
            <Icon name="paperclip" size={14} /> {s.file_name || t('submissions.downloadFile')}
          </a>
        )}
      </div>
      {s.file_url && isImage && fileUrl && (
        <a href={fileUrl} target="_blank" rel="noreferrer" title={t('submissions.viewLarge')}>
          <img
            src={fileUrl}
            alt={s.file_name || t('submissions.imageAlt')}
            className="submission-thumb"
            loading="lazy"
          />
        </a>
      )}
    </div>
  );
}
