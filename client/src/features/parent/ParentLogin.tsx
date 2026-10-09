import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setAuth } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentLogin() {
  const { t } = useTranslation(['parent', 'common']);
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
      toast(t('auth.welcome', { name: data.parent.name }), 'success');
      navigate('/parent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('auth.loginError');
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
        <h1 className="login-title">{t('auth.loginTitle')}</h1>
        <p className="login-sub">{t('auth.loginSub')}</p>
        {error && (
          <div className="auth-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <label className="field">
          <span className="field-label">{t('auth.phone')}</span>
          <input
            className="text-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            placeholder={t('auth.phonePlaceholder')}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{t('auth.password')}</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder={t('auth.passwordPlaceholder')}
            required
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? t('auth.loggingIn') : t('auth.loginAction')}
        </button>
        <p className="login-hint">
          {t('auth.noAccount')}{' '}
          <Link className="link" to="/parent/register">
            {t('auth.registerNow')}
          </Link>
        </p>
      </form>
    </div>
  );
}
