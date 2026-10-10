import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setAuth, takePostLoginRedirect } from '../../shared/api/client';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { User } from '../../shared/types';
import './Login.css';

export function Login() {
  const { t } = useTranslation(['auth', 'common']);
  const [username, setUsername] = useState('');
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
      const data = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuth(data.token, data.user);
      toast(t('welcome', { name: data.user.name }), 'success');
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
      setError(err instanceof Error ? err.message : t('fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-topbar">
        <ThemeLangSwitch />
      </div>
      <form className="login-card" onSubmit={submit} noValidate={false}>
        <div className="login-logo">E</div>
        <h1 className="login-title">{t('brand')}</h1>
        <p className="login-sub">{t('sub')}</p>
        {error && (
          <p className="login-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}
        <label className="field">
          <span className="field-label">{t('username')}</span>
          <input
            className="text-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="field">
          <span className="field-label">{t('password')}</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('submitting') : t('submit')}
        </button>
        <p className="login-hint">{t('demoHint')}</p>
      </form>
    </div>
  );
}
