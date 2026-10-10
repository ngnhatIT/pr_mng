import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setAuth, takePostLoginRedirect } from '../../shared/api/client';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { ForgotPasswordModal } from '../auth/Login';
import { parentApi } from './parent.api';
import { isValidVNPhone } from '../../shared/validation';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import './parent.css';

export function ParentLogin() {
  const { t } = useTranslation(['parent', 'common']);
  useDocumentTitle(t('auth.loginTitle'));
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'phone' | 'password'>();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: { phone?: string; password?: string } = {};
    if (!phone.trim()) errs.phone = t('auth.phoneEmpty');
    else if (!isValidVNPhone(phone)) errs.phone = t('auth.phoneInvalid');
    if (!password) errs.password = t('auth.passwordEmpty');
    if (!show(errs)) return;
    setBusy(true);
    try {
      const data = await parentApi.login(phone, password);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      // Quay lại deep-link đã lưu (khi bị 401 hoặc vào trang cần login).
      const next = takePostLoginRedirect();
      navigate(next && next.startsWith('/parent') ? next : '/parent', { replace: true });
    } catch (err) {
      // Lỗi đăng nhập (sai SĐT/mật khẩu) hiện inline dưới ô mật khẩu, focus để nhập lại
      show({ password: err instanceof Error ? err.message : t('auth.loginError') });
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
        <Field label={t('auth.phone')} error={errors.phone} required>
          <input
            className="text-input"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              clear('phone');
            }}
            autoComplete="tel"
            inputMode="tel"
            autoFocus
            placeholder={t('auth.phonePlaceholder')}
            ref={refFor('phone')}
          />
        </Field>
        <Field label={t('auth.password')} error={errors.password} required>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear('password');
            }}
            autoComplete="current-password"
            placeholder={t('auth.passwordPlaceholder')}
            ref={refFor('password')}
          />
        </Field>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? t('auth.loggingIn') : t('auth.loginAction')}
        </button>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" className="link" onClick={() => setForgotOpen(true)}>
            {t('auth.forgotLink')}
          </button>
        </div>
        <p className="login-hint">
          {t('auth.noAccount')}{' '}
          <Link className="link" to="/parent/register">
            {t('auth.registerNow')}
          </Link>
        </p>
      </form>
      {forgotOpen && (
        <ForgotPasswordModal
          kind="parent"
          title={t('auth.forgotTitle')}
          desc={t('auth.forgotDesc')}
          fieldLabel={t('auth.phone')}
          emptyError={t('auth.phoneEmpty')}
          sentMessage={t('auth.forgotSent')}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </div>
  );
}
