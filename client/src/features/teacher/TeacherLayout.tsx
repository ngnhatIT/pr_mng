import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getUser, logout as doLogout } from '../../shared/api/client';
import { Icon, IconName } from '../../shared/components/icons';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import './TeacherLayout.css';

const TABS: { to: string; labelKey: string; end?: boolean; icon: IconName }[] = [
  { to: '/teacher', labelKey: 'bottomNav.today', end: true, icon: 'home' },
  { to: '/teacher/diem-danh', labelKey: 'bottomNav.attendance', icon: 'clipboard' },
  { to: '/teacher/bai-tap', labelKey: 'bottomNav.homework', icon: 'book' },
  { to: '/teacher/diem-so', labelKey: 'bottomNav.grades', icon: 'cap' },
  { to: '/teacher/luong', labelKey: 'bottomNav.salary', icon: 'banknote' },
];

export function TeacherLayout() {
  const { t } = useTranslation(['teacher', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();

  useEffect(() => {
    const active = [...TABS]
      .sort((a, b) => b.to.length - a.to.length)
      .find((tab) => (tab.end ? location.pathname === tab.to : location.pathname.startsWith(tab.to)));
    document.title = active ? `${t(active.labelKey)} - EduCenter Pro` : 'EduCenter Pro';
  }, [location.pathname, t]);

  const logout = () => {
    void doLogout();
    void navigate('/login');
  };

  return (
    <div className="parent-shell">
      <header className="parent-topbar">
        <div className="parent-brand">
          <div className="brand-logo brand-logo-sm">E</div>
          <div>
            <div className="parent-app-name">EduCenter Pro</div>
            <div className="parent-user-name">{user?.name || t('bottomNav.teacherFallback')}</div>
          </div>
        </div>
        <div className="parent-topbar-actions">
          <ThemeLangSwitch />
          <button
            className="btn btn-ghost btn-sm"
            onClick={logout}
            aria-label={t('nav.logout', { ns: 'common' })}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </header>

      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent', { ns: 'common' })}
      </a>
      <main className="parent-content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="parent-bottomnav" aria-label={t('bottomNav.navLabel')}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `pnav-link${isActive ? ' active' : ''}`}
          >
            <span className="pnav-icon">
              <Icon name={tab.icon} size={22} />
            </span>
            <span>{t(tab.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
