import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setAuth, takePostLoginRedirect } from '../../shared/api/client';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import { User } from '../../shared/types';
import './Login.css';

export function Login() {
  const { t } = useTranslation(['auth', 'common']);
  useDocumentTitle('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'username' | 'password'>();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: { username?: string; password?: string } = {};
    if (!username.trim()) errs.username = t('usernameRequired');
    if (!password) errs.password = t('passwordRequired');
    if (!show(errs)) return;
    setBusy(true);
    try {
      const data = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuth(data.token, data.user);
      // Quay lại deep-link đã lưu (khi bị 401 hoặc vào trang cần login), nếu không thì về home theo role.
      const next = takePostLoginRedirect();
      if (next) {
        navigate(next, { replace: true });
        return;
      }
      const role = data.user.role;
      if (role === 'teacher') navigate('/teacher');
      else if (role === 'parent') navigate('/parent');
      else navigate('/app');
    } catch (err) {
      // Lỗi đăng nhập (sai tài khoản/mật khẩu) hiện inline dưới ô mật khẩu, focus để nhập lại
      show({ password: err instanceof Error ? err.message : t('fail') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-topbar">
        <ThemeLangSwitch />
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">E</div>
        <h1 className="login-title">{t('brand')}</h1>
        <p className="login-sub">{t('sub')}</p>
        <Field label={t('username')} error={errors.username} required>
          <input
            className="text-input"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clear('username');
            }}
            autoComplete="username"
            autoFocus
            ref={refFor('username')}
          />
        </Field>
        <Field label={t('password')} error={errors.password} required>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            autoComplete="current-password"
            ref={refFor('password')}
          />
        </Field>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('submitting') : t('submit')}
        </button>
        <p className="login-hint">{t('demoHint')}</p>
      </form>
    </div>
  );
}
