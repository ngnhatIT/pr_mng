import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { getUser, clearAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentProfile() {
  const { t } = useTranslation(['parent', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const user = getUser();
  const [childCount, setChildCount] = useState<number | null>(null);

  useEffect(() => {
    parentApi
      .children()
      .then((c) => setChildCount(c.length))
      .catch(() => setChildCount(0));
  }, []);

  const logout = () => {
    clearAuth();
    toast(t('profile.loggedOut'), 'info');
    navigate('/parent/login');
  };

  return (
    <div className="parent-page">
      <h1 className="parent-title">{t('profile.title')}</h1>
      <p className="muted">{t('profile.subtitle')}</p>

      <section className="card profile-card">
        <div className="child-avatar child-avatar-lg">{(user?.name || 'P').charAt(0).toUpperCase()}</div>
        <h2 className="card-title">{user?.name || t('profile.parentFallback')}</h2>
        <p className="muted mono">{user?.username || ''}</p>
        {childCount !== null && (
          <p className="muted">
            <Trans i18nKey="profile.watching" ns="parent" values={{ count: childCount }} />
          </p>
        )}
      </section>

      <section className="card">
        <Link className="quick-action" to="/parent/referral">
          <span className="quick-action-icon">
            <Icon name="gift" size={20} />
          </span>
          <span className="quick-action-text">
            <strong>{t('profile.referral')}</strong>
            <small>{t('profile.referralDesc')}</small>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
        <div style={{ height: 10 }} />
        <Link className="quick-action" to="/parent/leaves">
          <span className="quick-action-icon">
            <Icon name="calendar-x" size={20} />
          </span>
          <span className="quick-action-text">
            <strong>{t('profile.leaves')}</strong>
            <small>{t('profile.leavesDesc')}</small>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
      </section>

      <button className="btn btn-block" onClick={logout}>
        <Icon name="logout" size={16} />
        {t('nav.logout', { ns: 'common' })}
      </button>
    </div>
  );
}
