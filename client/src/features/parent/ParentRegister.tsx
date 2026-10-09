import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentRegister() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      const msg = 'Mật khẩu nhập lại không khớp';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    if (password.length < 6) {
      const msg = 'Mật khẩu phải có ít nhất 6 ký tự';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await parentApi.register(phone, password, name);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      toast('Đăng ký thành công!', 'success');
      navigate('/parent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đăng ký thất bại';
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
        <h1 className="login-title">Đăng ký phụ huynh</h1>
        <p className="login-sub">Tạo tài khoản để liên kết với hồ sơ của con bạn</p>
        {error && (
          <div className="auth-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <label className="field">
          <span className="field-label">Họ tên *</span>
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Nguyễn Văn A"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Số điện thoại *</span>
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
          <span className="field-label">Mật khẩu *</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Ít nhất 6 ký tự"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Nhập lại mật khẩu *</span>
          <input
            className="text-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu"
            required
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Đang đăng ký...' : 'Đăng ký'}
        </button>
        <p className="login-hint">
          Đã có tài khoản?{' '}
          <Link className="link" to="/parent/login">
            Đăng nhập
          </Link>
        </p>
      </form>
    </div>
  );
}
