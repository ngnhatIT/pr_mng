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
    <Modal title={title} onClose={onClose} dirty={identifier.trim() !== ''}>
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
  // v30: bước 2 khi tài khoản bật xác thực 2 lớp
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const { errors, refFor, show, clear } = useFieldErrors<'username' | 'password' | 'code'>();
  const navigate = useNavigate();

  type LoginOk = { token: string; user: User; must_change_password?: boolean };
  const finish = (data: LoginOk) => {
    // Cờ bắt đổi mật khẩu có thể nằm trong user hoặc ở top-level response
    setAuth(data.token, data.must_change_password ? { ...data.user, must_change_password: true } : data.user);
    // Quay lại deep-link đã lưu (khi bị 401 hoặc vào trang cần login) nếu thuộc portal của role
    // (B4-2: bỏ link của portal khác), nếu không thì về home theo role.
    const role = data.user.role;
    const home = role === 'teacher' ? '/teacher' : role === 'parent' ? '/parent' : '/app';
    const next = takePostLoginRedirect(home);
    void navigate(next ?? home, { replace: !!next });
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!show(code.trim() ? {} : { code: t('mfa.codeRequired') })) return;
    setBusy(true);
    try {
      finish(
        await api<LoginOk>('/auth/login/2fa', {
          method: 'POST',
          body: JSON.stringify({ mfa_token: mfaToken, code: code.trim() }),
        })
      );
    } catch (err) {
      const c = (err as { code?: string }).code;
      if (c === 'MFA_TOKEN_INVALID') {
        setMfaToken('');
        setCode('');
        show({ password: t('mfa.expired') });
      } else show({ code: t('mfa.invalid') });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: { username?: string; password?: string } = {};
    if (!username.trim()) errs.username = t('usernameRequired');
    if (!password) errs.password = t('passwordRequired');
    if (!show(errs)) return;
    setBusy(true);
    try {
      const data = await api<LoginOk | { mfa_required: true; mfa_token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if ('mfa_required' in data) {
        setMfaToken(data.mfa_token);
        setPassword('');
        return;
      }
      finish(data);
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
      {mfaToken ? (
        <form className="login-card" onSubmit={submitCode}>
          <div className="login-logo">E</div>
          <h1 className="login-title">{t('mfa.title')}</h1>
          <p className="login-sub">{t('mfa.desc')}</p>
          <Field label={t('mfa.code')} error={errors.code} hint={t('mfa.recoveryHint')} required>
            <input
              className="text-input"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                clear('code');
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={20}
              autoFocus
              ref={refFor('code')}
            />
          </Field>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('mfa.verify')}
          </button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="link"
              onClick={() => {
                setMfaToken('');
                setCode('');
              }}
            >
              {t('mfa.back')}
            </button>
          </div>
        </form>
      ) : (
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
      )}
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
