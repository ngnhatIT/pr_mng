import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../shared/api/client';
import { Icon, IconName } from '../../shared/components/icons';
import './parent.css';

const TABS: { to: string; label: string; end?: boolean; icon: IconName }[] = [
  { to: '/parent', label: 'Trang chủ', end: true, icon: 'home' },
  { to: '/parent/leaves', label: 'Nghỉ phép', icon: 'calendar-x' },
  { to: '/parent/referral', label: 'Giới thiệu', icon: 'gift' },
  { to: '/parent/toi', label: 'Tôi', icon: 'user' },
];

export function ParentLayout() {
  const navigate = useNavigate();
  const user = getUser();

  const logout = () => {
    clearAuth();
    navigate('/parent/login');
  };

  return (
    <div className="parent-shell">
      <header className="parent-topbar">
        <div className="parent-brand">
          <div className="brand-logo brand-logo-sm">E</div>
          <div>
            <div className="parent-app-name">EduCenter Pro</div>
            <div className="parent-user-name">{user?.name || 'Phụ huynh'}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout} aria-label="Đăng xuất">
          <Icon name="logout" size={18} />
        </button>
      </header>

      <main className="parent-content">
        <Outlet />
      </main>

      <nav className="parent-bottomnav" aria-label="Điều hướng phụ huynh">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `pnav-link${isActive ? ' active' : ''}`}
          >
            <span className="pnav-icon">
              <Icon name={t.icon} size={22} />
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
