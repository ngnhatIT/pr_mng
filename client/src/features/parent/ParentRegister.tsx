import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setAuth, api } from '../../shared/api/client';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import './parent.css';

export function ParentRegister() {
  const { t } = useTranslation(['parent', 'common']);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [center, setCenter] = useState<{ id: number; name: string } | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api<{ id: number; name: string }>('/public/center')
      .then(setCenter)
      .catch(() => setCenter(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      const msg = t('auth.passwordMismatch');
      setError(msg);
      toast(msg, 'error');
      return;
    }
    if (password.length < 6) {
      const msg = t('auth.passwordTooShort');
      setError(msg);
      toast(msg, 'error');
      return;
    }
    if (!center) {
      const msg = t('auth.centerRequired');
      setError(msg);
      toast(msg, 'error');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await parentApi.register(phone, password, name, center.id);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      toast(t('auth.registerSuccess'), 'success');
      navigate('/parent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('auth.registerError');
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
        <h1 className="login-title">{t('auth.registerTitle')}</h1>
        <p className="login-sub">{t('auth.registerSub')}</p>
        {center && <p className="login-sub">{t('auth.registerAtCenter', { name: center.name })}</p>}
        {error && (
          <div className="auth-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <label className="field">
          <span className="field-label">{t('auth.fullName')}</span>
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder={t('auth.namePlaceholder')}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{t('auth.phoneRequired')}</span>
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
          <span className="field-label">{t('auth.passwordRequired')}</span>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={t('auth.passwordHint')}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{t('auth.confirmPassword')}</span>
          <input
            className="text-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder={t('auth.confirmPlaceholder')}
            required
          />
        </label>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? t('auth.registering') : t('auth.registerAction')}
        </button>
        <p className="login-hint">
          {t('auth.hasAccount')}{' '}
          <Link className="link" to="/parent/login">
            {t('auth.loginAction')}
          </Link>
        </p>
      </form>
    </div>
  );
}
