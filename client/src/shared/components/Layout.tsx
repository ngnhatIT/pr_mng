import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getUser, logout as doLogout } from '../../shared/api/client';
import { Icon, IconName } from './icons';
import { ThemeLangSwitch } from '../ui/ThemeLangSwitch';
import { ChangePasswordModal } from './ChangePasswordModal';
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
  const [showChangePw, setShowChangePw] = useState(false);
  // Chỉ inert sidebar khi ở mobile và drawer đóng (desktop sidebar luôn hiển thị, không được inert)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [myPerms, setMyPerms] = useState<Set<string> | null>(null);
  const isSuperadmin = user?.role === 'superadmin';

  // Tải quyền của mình để ẩn menu không được phép (fail-open: lỗi thì hiện tất cả)
  useEffect(() => {
    let cancelled = false;
    rolesApi
      .mine()
      .then((r) => {
        if (!cancelled) setMyPerms(new Set(r.map((p) => p.code)));
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

  // Escape đóng drawer mobile + focus trap (WCAG 2.4.3)
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const aside = document.querySelector<HTMLElement>('.sidebar.open');
      if (!aside) return;
      const focusables = Array.from(
        aside.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Focus vào link đầu tiên khi mở drawer
    document.querySelector<HTMLElement>('.sidebar.open a, .sidebar.open button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const title = pageTitleFor(t, location.pathname, isSuperadmin);

  useEffect(() => {
    document.title = `${title} - EduCenter Pro`;
  }, [title]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>
      <div
        className={`scrim${drawerOpen ? ' show' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`sidebar${drawerOpen ? ' open' : ''}`}
        aria-label={t('nav.main')}
        aria-hidden={isMobile && !drawerOpen ? true : undefined}
        // inert: chỉ khi mobile và drawer đóng (desktop sidebar luôn tương tác được)
        {...(isMobile && !drawerOpen ? { inert: '' } : {})}
      >
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
            <div className="user-avatar" aria-hidden="true">
              <Icon name="user" size={18} />
            </div>
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
            <div className="topbar-avatar" aria-hidden="true">
              <Icon name="user" size={17} />
            </div>
            <span>{user?.name}</span>
          </div>
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => setShowChangePw(true)}
            aria-label={t('nav.changePassword', 'Đổi mật khẩu')}
            title={t('nav.changePassword', 'Đổi mật khẩu')}
          >
            <Icon name="key" size={18} />
          </button>
          <button
            className="btn btn-icon btn-ghost"
            onClick={logout}
            aria-label={t('nav.logout')}
            title={t('nav.logout')}
          >
            <Icon name="logout" size={18} />
          </button>
        </header>
        <main className="page-scroll" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}
