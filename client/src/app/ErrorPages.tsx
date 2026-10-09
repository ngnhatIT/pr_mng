import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../shared/components/icons';

/** Trang 404 — thân thiện, có nút quay lại thay vì đá về landing lặng lẽ. */
export function NotFound() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return (
    <div className="empty-page">
      <div className="empty-page-icon">
        <Icon name="search" size={48} />
      </div>
      <h1>{t('notFound.title')}</h1>
      <p className="muted">{t('notFound.desc')}</p>
      <div className="empty-page-actions">
        <button className="btn btn-primary" onClick={() => navigate(-1)}>
          {t('notFound.back')}
        </button>
        <Link className="btn btn-ghost" to="/">
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
}

/** Trang 403 — phân biệt rõ "không có quyền" với "không tồn tại". */
export function Forbidden() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return (
    <div className="empty-page">
      <div className="empty-page-icon">
        <Icon name="lock" size={48} />
      </div>
      <h1>{t('forbidden.title')}</h1>
      <p className="muted">{t('forbidden.desc')}</p>
      <div className="empty-page-actions">
        <button className="btn btn-primary" onClick={() => navigate(-1)}>
          {t('notFound.back')}
        </button>
        <Link className="btn btn-ghost" to="/">
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
}
