import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Modal } from './Modal';
import { Field, useFieldErrors } from './Form';
import { useToast } from '../ui/toast';
import { api, authPath, getUser, logout, setAuth, tryRefresh, updateUser } from '../api/client';

interface Props {
  onClose: () => void;
  /** Bắt buộc đổi (must_change_password): không đóng được, chỉ có Đổi mật khẩu hoặc Đăng xuất. */
  forced?: boolean;
}

/** Form đổi mật khẩu (POST /auth|/parent/change-password, thu hồi mọi session khác). */
export function ChangePasswordModal({ onClose, forced }: Props) {
  const { t } = useTranslation('common');
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Lỗi validation hiện ngay dưới field + focus field lỗi (skill 8.2)
  const { errors, refFor, show, clear } = useFieldErrors<'old' | 'new' | 'confirm'>();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: { new?: string; confirm?: string } = {};
    if (newPassword.length < 8) errs.new = t('changePassword.tooShort');
    else if (newPassword !== confirmPw) errs.confirm = t('changePassword.mismatch');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await api(authPath('change-password'), {
        method: 'POST',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      updateUser({ must_change_password: false });
      // Lấy access token/user mới từ server (token cũ có thể còn mang cờ bắt đổi mật khẩu). Best-effort.
      await tryRefresh();
      toast(t('changePassword.success'), 'success');
      onClose();
    } catch (err) {
      // Lỗi server hiện ngay dưới field liên quan: lỗi về mật khẩu mới (yếu/trùng cũ) dưới ô mới,
      // còn lại (thường là sai mật khẩu hiện tại) dưới ô hiện tại (FE-6).
      const msg = err instanceof Error ? err.message : t('changePassword.fail');
      const code = (err as { code?: string }).code;
      show(code === 'WEAK_PASSWORD' || code === 'SAME_PASSWORD' ? { new: msg } : { old: msg });
    } finally {
      setBusy(false);
    }
  };

  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const logoutAll = async () => {
    setConfirmingLogout(false);
    setBusy(true);
    try {
      // SEC-2: server giữ phiên hiện tại, thu hồi mọi phiên khác + access token cũ và trả token mới.
      const data = await api<{ ok: boolean; token?: string }>(authPath('logout-all'), { method: 'POST' });
      const user = getUser();
      if (data.token && user) setAuth(data.token, user);
      toast(t('changePassword.logoutAllSuccess'), 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('changePassword.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title={t('changePassword.title')} onClose={forced ? () => {} : onClose} hideClose={forced}>
        <form onSubmit={submit} className="form-grid">
          {forced && <p className="muted">{t('changePassword.forcedNotice')}</p>}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Field label={t('changePassword.old')} required error={errors.old}>
            <input
              ref={refFor('old')}
              type="password"
              className="text-input"
              value={oldPassword}
              onChange={(e) => {
                setOldPassword(e.target.value);
                clear('old');
              }}
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('changePassword.new')} required error={errors.new}>
            <input
              ref={refFor('new')}
              type="password"
              className="text-input"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                clear('new');
              }}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </Field>
          <Field label={t('changePassword.confirm')} required error={errors.confirm}>
            <input
              ref={refFor('confirm')}
              type="password"
              className="text-input"
              value={confirmPw}
              onChange={(e) => {
                setConfirmPw(e.target.value);
                clear('confirm');
              }}
              required
              autoComplete="new-password"
            />
          </Field>
          {/* Dùng modal-actions chuẩn (form-actions không có CSS) */}
          <div className="modal-actions">
            {forced ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  const loginPath = getUser()?.role === 'parent' ? '/parent/login' : '/login';
                  void logout().then(() => navigate(loginPath, { replace: true }));
                }}
              >
                {t('nav.logout')}
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>
                  {t('actions.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setConfirmingLogout(true)}
                  disabled={busy}
                >
                  {t('changePassword.logoutAll')}
                </button>
              </>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? t('actions.saving') : t('changePassword.submit')}
            </button>
          </div>
        </form>
      </Modal>
      {confirmingLogout && (
        <ConfirmDialog
          title={t('changePassword.logoutAll')}
          message={t('changePassword.logoutAllConfirm')}
          onClose={() => setConfirmingLogout(false)}
          onConfirm={logoutAll}
          danger
        />
      )}
    </>
  );
}
