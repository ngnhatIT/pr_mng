import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, setAuth, takePostLoginRedirect } from '../../shared/api/client';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { Modal } from '../../shared/components/Modal';
import { useToast } from '../../shared/ui/toast';
import { ThemeLangSwitch } from '../../shared/ui/ThemeLangSwitch';
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle';
import { User } from '../../shared/types';
import './Login.css';

/**
 * Modal "Quên mật khẩu" dùng chung cho staff (Login) và phụ huynh (ParentLogin).
 * Luồng trung thực: gửi yêu cầu tới server, admin xử lý và báo mật khẩu tạm
 * qua kênh ngoài hệ thống (chưa có hạ tầng email/SMS).
 */
export function ForgotPasswordModal({
  kind,
  title,
  desc,
  fieldLabel,
  emptyError,
  sentMessage,
  onClose,
}: {
  kind: 'staff' | 'parent';
  title: string;
  desc: string;
  fieldLabel: string;
  emptyError: string;
  sentMessage: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const id = identifier.trim();
    if (!id) {
      setError(emptyError);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(kind === 'staff' ? { kind, username: id } : { kind, phone: id }),
      });
      toast(sentMessage, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('api.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {desc}
      </p>
      <form onSubmit={submit}>
        <Field label={fieldLabel} error={error} required>
          <input
            className="text-input"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setError('');
            }}
            autoComplete={kind === 'staff' ? 'username' : 'tel'}
            autoFocus
          />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('actions.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.sending') : t('actions.send')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Login() {
  const { t } = useTranslation(['auth', 'common']);
  useDocumentTitle('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
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
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" className="link" onClick={() => setForgotOpen(true)}>
            {t('forgotLink')}
          </button>
        </div>
        <p className="login-hint">{t('demoHint')}</p>
      </form>
      {forgotOpen && (
        <ForgotPasswordModal
          kind="staff"
          title={t('forgotTitle')}
          desc={t('forgotDesc')}
          fieldLabel={t('username')}
          emptyError={t('usernameRequired')}
          sentMessage={t('forgotSent')}
          onClose={() => setForgotOpen(false)}
        />
      )}
    </div>
  );
}
