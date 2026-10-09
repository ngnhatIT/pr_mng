import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../shared/api/client';
import { Icon, IconName } from '../../shared/components/icons';

const TABS: { to: string; label: string; end?: boolean; icon: IconName }[] = [
  { to: '/teacher', label: 'Buổi dạy', end: true, icon: 'home' },
  { to: '/teacher/diem-danh', label: 'Điểm danh', icon: 'clipboard' },
  { to: '/teacher/bai-tap', label: 'Bài tập', icon: 'book' },
  { to: '/teacher/diem-so', label: 'Điểm số', icon: 'cap' },
  { to: '/teacher/luong', label: 'Lương', icon: 'banknote' },
];

export function TeacherLayout() {
  const navigate = useNavigate();
  const user = getUser();

  const logout = () => {
    clearAuth();
    navigate('/login');
  };

  return (
    <div className="parent-shell">
      <header className="parent-topbar">
        <div className="parent-brand">
          <div className="brand-logo brand-logo-sm">E</div>
          <div>
            <div className="parent-app-name">EduCenter Pro</div>
            <div className="parent-user-name">{user?.name || 'Giáo viên'}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout} aria-label="Đăng xuất">
          <Icon name="logout" size={18} />
        </button>
      </header>

      <main className="parent-content">
        <Outlet />
      </main>

      <nav className="parent-bottomnav" aria-label="Điều hướng giáo viên">
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
