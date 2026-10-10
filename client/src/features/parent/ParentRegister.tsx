import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setAuth, api } from '../../shared/api/client';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { isValidVNPhone } from '../../shared/validation';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import './parent.css';

export function ParentRegister() {
  const { t } = useTranslation(['parent', 'common']);
  useDocumentTitle(t('auth.registerTitle'));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'phone' | 'password' | 'confirm'>();
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
    const errs: { phone?: string; password?: string; confirm?: string } = {};
    if (!phone.trim()) errs.phone = t('auth.phoneEmpty');
    else if (!isValidVNPhone(phone)) errs.phone = t('auth.phoneInvalid');
    if (!password) errs.password = t('auth.passwordEmpty');
    else if (password.length < 8) errs.password = t('auth.passwordTooShort');
    if (password && password !== confirm) errs.confirm = t('auth.passwordMismatch');
    if (!show(errs)) return;
    if (!center) {
      // Không gắn với field nào: báo 1 kênh duy nhất qua toast, bỏ banner trùng lặp
      toast(t('auth.centerRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const data = await parentApi.register(phone, password, name, center.id);
      setAuth(data.token, { ...data.parent, role: 'parent', username: data.parent.phone });
      toast(t('auth.registerSuccess'), 'success');
      navigate('/parent');
    } catch (err) {
      // Lỗi đăng ký (thường do SĐT đã dùng): hiện inline dưới ô SĐT, focus để sửa
      show({ phone: err instanceof Error ? err.message : t('auth.registerError') });
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
        <Field label={t('auth.fullName')}>
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder={t('auth.namePlaceholder')}
          />
        </Field>
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
            autoComplete="new-password"
            placeholder={t('auth.passwordHint')}
            ref={refFor('password')}
          />
        </Field>
        <Field label={t('auth.confirmPassword')} error={errors.confirm} required>
          <input
            className="text-input"
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clear('confirm');
            }}
            autoComplete="new-password"
            placeholder={t('auth.confirmPlaceholder')}
            ref={refFor('confirm')}
          />
        </Field>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
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
