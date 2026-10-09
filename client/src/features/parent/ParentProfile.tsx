import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentProfile() {
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
    toast('Đã đăng xuất', 'info');
    navigate('/parent/login');
  };

  return (
    <div className="parent-page">
      <h1 className="parent-title">Tài khoản</h1>
      <p className="muted">Thông tin tài khoản phụ huynh của bạn</p>

      <section className="card profile-card">
        <div className="child-avatar child-avatar-lg">{(user?.name || 'P').charAt(0).toUpperCase()}</div>
        <h2 className="card-title">{user?.name || 'Phụ huynh'}</h2>
        <p className="muted mono">{user?.username || ''}</p>
        {childCount !== null && (
          <p className="muted">
            Đang theo dõi <strong>{childCount}</strong> con
          </p>
        )}
      </section>

      <section className="card">
        <Link className="quick-action" to="/parent/referral">
          <span className="quick-action-icon">
            <Icon name="gift" size={20} />
          </span>
          <span className="quick-action-text">
            <strong>Giới thiệu bạn bè</strong>
            <small>Chia sẻ mã, nhận credits giảm học phí</small>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
        <div style={{ height: 10 }} />
        <Link className="quick-action" to="/parent/leaves">
          <span className="quick-action-icon">
            <Icon name="calendar-x" size={20} />
          </span>
          <span className="quick-action-text">
            <strong>Đơn xin nghỉ phép</strong>
            <small>Xem trạng thái các đơn đã gửi</small>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
      </section>

      <button className="btn btn-block" onClick={logout}>
        <Icon name="logout" size={16} />
        Đăng xuất
      </button>
    </div>
  );
}
