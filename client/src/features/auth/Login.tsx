import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAuth } from '../../shared/api/client';
import { useToast } from '../../shared/ui/toast';
import { User } from '../../shared/types';

export function Login() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('123456');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuth(data.token, data.user);
      toast(`Xin chào, ${data.user.name}!`, 'success');
      const role = data.user.role;
      if (role === 'teacher') navigate('/teacher');
      else if (role === 'parent') navigate('/parent');
      else navigate('/app');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Đăng nhập thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">E</div>
        <h1 className="login-title">EduCenter Pro</h1>
        <p className="login-sub">Phần mềm quản lý trung tâm ngoại ngữ, lớp học</p>
        <label className="field">
          <span className="field-label">Tên đăng nhập</span>
          <input
            className="text-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
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
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
        <p className="login-hint">Tài khoản demo: admin / 123456</p>
      </form>
    </div>
  );
}
