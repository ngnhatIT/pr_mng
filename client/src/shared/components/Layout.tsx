import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getUser } from '../../shared/api/client';
import { ROLE_LABEL, labelOf } from '../../shared/types';
import { Icon, IconName } from './icons';
import { rolesApi } from '../../features/system/roles.api';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: IconName;
  /** Permission cần có để thấy menu này (không có = ai cũng thấy). */
  perm?: string;
}

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Quản lý',
    items: [
      { to: '/app', label: 'Tổng quan', end: true, icon: 'grid', perm: 'reports.view' },
      { to: '/app/students', label: 'Học viên', icon: 'users', perm: 'students.view' },
      { to: '/app/classes', label: 'Lớp học', icon: 'book', perm: 'classes.view' },
      { to: '/app/attendance', label: 'Điểm danh', icon: 'clipboard', perm: 'attendance.view' },
      { to: '/app/tuition', label: 'Học phí', icon: 'banknote', perm: 'invoices.view' },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { to: '/app/rooms', label: 'Phòng học', icon: 'building', perm: 'rooms.view' },
      { to: '/app/leaves', label: 'Nghỉ phép', icon: 'calendar-x', perm: 'leaves.view' },
      { to: '/app/trials', label: 'Học thử', icon: 'play', perm: 'trials.view' },
      { to: '/app/homework', label: 'Bài tập', icon: 'file', perm: 'homework.view' },
      { to: '/app/payroll', label: 'Lương GV', icon: 'chart', perm: 'payroll.view' },
      { to: '/app/teachers', label: 'Giáo viên', icon: 'cap', perm: 'teachers.view' },
    ],
  },
  {
    label: 'Tăng trưởng',
    items: [
      { to: '/app/leads', label: 'Lead', icon: 'filter', perm: 'leads.view' },
      { to: '/app/danh-gia', label: 'Đánh giá', icon: 'star', perm: 'reviews.view' },
      { to: '/app/gioi-thieu', label: 'Giới thiệu', icon: 'gift', perm: 'referrals.view' },
      { to: '/app/zalo-reminders', label: 'Nhắc Zalo', icon: 'bell', perm: 'notifications.view' },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { to: '/app/cau-hinh-thanh-toan', label: 'Cấu hình TT', icon: 'settings', perm: 'payment_config.manage' },
      { to: '/app/nhat-ky', label: 'Nhật ký', icon: 'shield', perm: 'audit.view' },
      { to: '/app/phan-quyen', label: 'Phân quyền', icon: 'key', perm: 'roles.view' },
    ],
  },
];

function pageTitleFor(pathname: string, isSuperadmin: boolean): string {
  const all: NavItem[] = [
    ...SECTIONS.flatMap((s) => s.items),
    ...(isSuperadmin ? [{ to: '/app/system', label: 'Hệ thống', icon: 'server' as IconName }] : []),
  ];
  let best: NavItem | null = null;
  for (const item of all) {
    if (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/')) {
      if (!best || item.to.length > best.to.length) best = item;
    }
  }
  return best?.label || 'EduCenter Pro';
}

export function Layout() {
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
    localStorage.removeItem('edu_token');
    localStorage.removeItem('edu_user');
    navigate('/login');
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

  const title = pageTitleFor(location.pathname, isSuperadmin);

  return (
    <div className="app-shell">
      <div className={`scrim${drawerOpen ? ' show' : ''}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`sidebar${drawerOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">E</div>
          <div>
            <div className="brand-name">EduCenter Pro</div>
            <div className="brand-sub">Quản lý trung tâm</div>
          </div>
        </div>
        <nav className="nav">
          {SECTIONS.map((s) => {
            const items = s.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <div key={s.label}>
                <div className="nav-section-label">{s.label}</div>
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
                    {n.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {isSuperadmin && (
            <div>
              <div className="nav-section-label">Quản trị</div>
              <NavLink to="/app/system" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span className="nav-icon">
                  <Icon name="server" size={16} />
                </span>
                Hệ thống
              </NavLink>
            </div>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-avatar">{(user?.name || 'U').charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{labelOf(ROLE_LABEL, user?.role || '')}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            className="btn btn-icon btn-ghost menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Mở menu"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar-title">{title}</div>
          <div className="spacer" />
          <div className="topbar-user">
            <div className="topbar-avatar">{(user?.name || 'U').charAt(0).toUpperCase()}</div>
            <span>{user?.name}</span>
          </div>
          <button
            className="btn btn-icon btn-ghost"
            onClick={logout}
            aria-label="Đăng xuất"
            title="Đăng xuất"
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
