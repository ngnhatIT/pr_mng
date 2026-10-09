import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Field } from './Form';
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPw) {
      setError(t('changePassword.mismatch', 'Mật khẩu mới không khớp'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('changePassword.tooShort', 'Mật khẩu phải từ 8 ký tự'));
      return;
    }
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
      setError(err instanceof Error ? err.message : t('changePassword.fail', 'Đổi mật khẩu thất bại'));
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    if (!confirm(t('changePassword.logoutAllConfirm', 'Đăng xuất khỏi tất cả thiết bị khác?'))) return;
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
    <Modal title={t('changePassword.title', 'Đổi mật khẩu')} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <Field label={t('changePassword.old', 'Mật khẩu hiện tại')} required>
          <input
            type="password"
            className="text-input"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Field label={t('changePassword.new', 'Mật khẩu mới')} required>
          <input
            type="password"
            className="text-input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={8}
          />
        </Field>
        <Field label={t('changePassword.confirm', 'Nhập lại mật khẩu mới')} required>
          <input
            type="password"
            className="text-input"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('actions.cancel', 'Hủy')}
          </button>
          <button type="button" className="btn btn-danger" onClick={logoutAll} disabled={busy}>
            {t('changePassword.logoutAll', 'Đăng xuất mọi thiết bị')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('actions.saving', 'Đang lưu...') : t('changePassword.submit', 'Đổi mật khẩu')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
