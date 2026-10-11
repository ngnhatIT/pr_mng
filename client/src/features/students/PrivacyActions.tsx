import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { http } from '../../shared/api/client';
import { Menu } from '../../shared/components/Menu';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { useMyPermissions } from '../system/roles.api';
import type { Student } from './students.api';

/**
 * Quyền dữ liệu cá nhân (GDPR / NĐ 13/2023): xuất toàn bộ dữ liệu của học viên (JSON) và ẩn danh
 * (xóa thông tin định danh, giữ chứng từ). Ẩn danh không hoàn tác -> phải gõ lại mã học viên để xác nhận.
 */
export function PrivacyActions({
  student,
  onChanged,
}: {
  student: Student & { anonymized_at?: string | null };
  onChanged: () => void;
}) {
  const { t } = useTranslation(['students', 'common']);
  const toast = useToast();
  const perms = useMyPermissions();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    try {
      const data = await http.get<unknown>(`/students/${student.id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `student-${student.code}-data.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toastApiError(toast, err, t('privacy.exportError'));
    }
  };

  const anonymize = async () => {
    setBusy(true);
    try {
      await http.post(`/students/${student.id}/anonymize`);
      toast(t('privacy.anonymized'), 'success');
      setConfirming(false);
      onChanged();
    } catch (err) {
      toastApiError(toast, err, t('privacy.anonymizeError'));
    } finally {
      setBusy(false);
    }
  };

  const canExport = perms.has('reports.export');
  const canErase = perms.has('students.delete') && !student.anonymized_at;
  if (!canExport && !canErase) return null;

  return (
    <>
      <Menu
        label={t('privacy.menu')}
        items={[
          canExport && { label: t('privacy.export'), icon: 'download', onSelect: () => void exportData() },
          canErase && {
            label: t('privacy.anonymize'),
            icon: 'shield',
            danger: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      {confirming && (
        <Modal title={t('privacy.confirmTitle')} onClose={() => setConfirming(false)}>
          <p>{t('privacy.confirmDesc')}</p>
          <div className="form-grid">
            <Field label={t('privacy.typeCode', { code: student.code })} span>
              <input
                className="text-input mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || typed.trim() !== student.code}
              onClick={() => void anonymize()}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              {t('privacy.anonymize')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
