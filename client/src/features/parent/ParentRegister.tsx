import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';

export function ParentRegister() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      toast('Mật khẩu nhập lại không khớp', 'error');
      return;
    }
    if (password.length < 6) {
      toast('Mật khẩu phải có ít nhất 6 ký tự', 'error');
      return;
    }
    setBusy(true);
    try {
      const data = await parentApi.register(phone, password, name);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      toast('Đăng ký thành công!', 'success');
      navigate('/parent');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Đăng ký thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page parent-auth">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">E</div>
        <h1 className="login-title">Đăng ký phụ huynh</h1>
        <p className="login-sub">Tạo tài khoản để liên kết với hồ sơ của con bạn</p>
        <label className="field">
          <span className="field-label">Họ tên *</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Số điện thoại *</span>
          <input
            className="text-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
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
