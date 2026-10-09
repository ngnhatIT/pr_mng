import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getUser, logout as doLogout } from '../../shared/api/client';
import { Icon, IconName } from './icons';
import { ThemeLangSwitch } from '../ui/ThemeLangSwitch';
import { rolesApi } from '../../features/system/roles.api';

interface NavItem {
  to: string;
  labelKey: string;
  end?: boolean;
  icon: IconName;
  /** Permission cần có để thấy menu này (không có = ai cũng thấy). */
  perm?: string;
}

const SECTIONS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.sections.manage',
    items: [
      { to: '/app', labelKey: 'nav.dashboard', end: true, icon: 'grid', perm: 'reports.view' },
      { to: '/app/students', labelKey: 'nav.students', icon: 'users', perm: 'students.view' },
      { to: '/app/classes', labelKey: 'nav.classes', icon: 'book', perm: 'classes.view' },
      { to: '/app/attendance', labelKey: 'nav.attendance', icon: 'clipboard', perm: 'attendance.view' },
      { to: '/app/tuition', labelKey: 'nav.tuition', icon: 'banknote', perm: 'invoices.view' },
    ],
  },
  {
    labelKey: 'nav.sections.ops',
    items: [
      { to: '/app/rooms', labelKey: 'nav.rooms', icon: 'building', perm: 'rooms.view' },
      { to: '/app/leaves', labelKey: 'nav.leaves', icon: 'calendar-x', perm: 'leaves.view' },
      { to: '/app/trials', labelKey: 'nav.trials', icon: 'play', perm: 'trials.view' },
      { to: '/app/homework', labelKey: 'nav.homework', icon: 'file', perm: 'homework.view' },
      { to: '/app/payroll', labelKey: 'nav.payroll', icon: 'chart', perm: 'payroll.view' },
      { to: '/app/teachers', labelKey: 'nav.teachers', icon: 'cap', perm: 'teachers.view' },
    ],
  },
  {
    labelKey: 'nav.sections.growth',
    items: [
      { to: '/app/leads', labelKey: 'nav.leads', icon: 'filter', perm: 'leads.view' },
      { to: '/app/danh-gia', labelKey: 'nav.reviews', icon: 'star', perm: 'reviews.view' },
      { to: '/app/gioi-thieu', labelKey: 'nav.referrals', icon: 'gift', perm: 'referrals.view' },
      { to: '/app/zalo-reminders', labelKey: 'nav.zalo', icon: 'bell', perm: 'notifications.view' },
    ],
  },
  {
    labelKey: 'nav.sections.system',
    items: [
      {
        to: '/app/cau-hinh-thanh-toan',
        labelKey: 'nav.paymentConfig',
        icon: 'settings',
        perm: 'payment_config.manage',
      },
      { to: '/app/nhat-ky', labelKey: 'nav.audit', icon: 'shield', perm: 'audit.view' },
      { to: '/app/phan-quyen', labelKey: 'nav.roles', icon: 'key', perm: 'roles.view' },
    ],
  },
];

function pageTitleFor(t: (k: string) => string, pathname: string, isSuperadmin: boolean): string {
  const all: NavItem[] = [
    ...SECTIONS.flatMap((s) => s.items),
    ...(isSuperadmin ? [{ to: '/app/system', labelKey: 'nav.systemAdmin', icon: 'server' as IconName }] : []),
  ];
  let best: NavItem | null = null;
  for (const item of all) {
    if (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')) {
      if (!best || item.to.length > best.to.length) best = item;
    }
  }
  return best ? t(best.labelKey) : 'EduCenter Pro';
}

export function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [myPerms, setMyPerms] = useState<Set<string> | null>(null);
  const isSuperadmin = user?.role === 'superadmin';

  // Tải quyền của mình để ẩn menu không được phép (fail-open: lỗi thì hiện tất cả)
  useEffect(() => {
    let cancelled = false;
    rolesApi
      .mine()
      .then((r) => {
        if (!cancelled) setMyPerms(new Set(r.data.map((p) => p.code)));
      })
      .catch(() => {
        if (!cancelled) setMyPerms(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = (item: NavItem): boolean => {
    if (!item.perm) return true;
    if (myPerms === null) return true;
    return myPerms.has(item.perm);
  };

  const logout = () => {
    void doLogout().then(() => navigate('/login'));
  };

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const title = pageTitleFor(t, location.pathname, isSuperadmin);

  useEffect(() => {
    document.title = `${title} - EduCenter Pro`;
  }, [title]);

  return (
    <div className="app-shell">
      <div className={`scrim${drawerOpen ? ' show' : ''}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`sidebar${drawerOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">E</div>
          <div>
            <div className="brand-name">EduCenter Pro</div>
            <div className="brand-sub">{t('nav.tagline')}</div>
          </div>
        </div>
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={s.labelKey}>
                <div className="nav-section-label">{t(s.labelKey)}</div>
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <span className="nav-icon">
                      <Icon name={n.icon} size={16} />
                    </span>
                    {t(n.labelKey)}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {isSuperadmin && (
            <div>
              <div className="nav-section-label">{t('nav.sections.system')}</div>
              <NavLink to="/app/system" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span className="nav-icon">
                  <Icon name="server" size={16} />
                </span>
                {t('nav.systemAdmin')}
              </NavLink>
            </div>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">{(user?.name || 'U').charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{t('roles.' + (user?.role || ''))}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            className="btn btn-icon btn-ghost menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar-title">{title}</div>
          <div className="spacer" />
          <ThemeLangSwitch />
          <div className="topbar-user">
            <div className="topbar-avatar">{(user?.name || 'U').charAt(0).toUpperCase()}</div>
            <span>{user?.name}</span>
          </div>
          <button
            className="btn btn-icon btn-ghost"
            onClick={logout}
            aria-label={t('nav.logout')}
            title={t('nav.logout')}
          >
            <Icon name="logout" size={18} />
          </button>
        </header>
        <main className="page-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
