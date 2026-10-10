import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Modal } from './Modal';
import { Field, useFieldErrors } from './Form';
import { useToast } from '../ui/toast';
import { api } from '../api/client';

interface Props {
  onClose: () => void;
}

/** Form đổi mật khẩu (gọi POST /auth/change-password, thu hồi mọi session khác). */
export function ChangePasswordModal({ onClose }: Props) {
  const { t } = useTranslation('common');
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Lỗi validation hiện ngay dưới field + focus field lỗi (skill 8.2)
  const { errors, refFor, show, clear } = useFieldErrors<'old' | 'new' | 'confirm'>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: { new?: string; confirm?: string } = {};
    if (newPassword.length < 8) errs.new = t('changePassword.tooShort', 'Mật khẩu phải từ 8 ký tự');
    else if (newPassword !== confirmPw)
      errs.confirm = t('changePassword.mismatch', 'Mật khẩu mới không khớp');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      toast(t('changePassword.success', 'Đổi mật khẩu thành công'), 'success');
      onClose();
    } catch (err) {
      // Lỗi server (thường là sai mật khẩu hiện tại): hiện ngay dưới field đó
      show({ old: err instanceof Error ? err.message : t('changePassword.fail', 'Đổi mật khẩu thất bại') });
    } finally {
      setBusy(false);
    }
  };

  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const logoutAll = async () => {
    setConfirmingLogout(false);
    setBusy(true);
    try {
      await api('/auth/logout-all', { method: 'POST' });
      toast(t('changePassword.logoutAllSuccess', 'Đã đăng xuất khỏi tất cả thiết bị'), 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('changePassword.fail', 'Thất bại'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title={t('changePassword.title', 'Đổi mật khẩu')} onClose={onClose}>
        <form onSubmit={submit} className="form-grid">
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Field label={t('changePassword.old', 'Mật khẩu hiện tại')} required error={errors.old}>
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
          <Field label={t('changePassword.new', 'Mật khẩu mới')} required error={errors.new}>
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
          <Field label={t('changePassword.confirm', 'Nhập lại mật khẩu mới')} required error={errors.confirm}>
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
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('actions.cancel', 'Hủy')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmingLogout(true)}
              disabled={busy}
            >
              {t('changePassword.logoutAll', 'Đăng xuất mọi thiết bị')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('actions.saving', 'Đang lưu...') : t('changePassword.submit', 'Đổi mật khẩu')}
            </button>
          </div>
        </form>
      </Modal>
      {confirmingLogout && (
        <ConfirmDialog
          title={t('changePassword.logoutAll', 'Đăng xuất mọi thiết bị')}
          message={t('changePassword.logoutAllConfirm', 'Đăng xuất khỏi tất cả thiết bị khác?')}
          onClose={() => setConfirmingLogout(false)}
          onConfirm={logoutAll}
          danger
        />
      )}
    </>
  );
}
