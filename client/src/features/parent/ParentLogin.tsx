import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentLogin() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await parentApi.login(phone, password);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      toast(`Xin chào, ${data.parent.name}!`, 'success');
      navigate('/parent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đăng nhập thất bại';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page parent-auth">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-logo">E</div>
        <h1 className="login-title">Cổng phụ huynh</h1>
        <p className="login-sub">Theo dõi việc học của con bạn mọi lúc, mọi nơi</p>
        {error && (
          <div className="auth-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <label className="field">
          <span className="field-label">Số điện thoại</span>
          <input
            className="text-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            placeholder="VD: 0912345678"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Mật khẩu</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu"
            required
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
        <p className="login-hint">
          Chưa có tài khoản?{' '}
          <Link className="link" to="/parent/register">
            Đăng ký ngay
          </Link>
        </p>
      </form>
    </div>
  );
}
