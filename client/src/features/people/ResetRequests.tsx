import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { formatDateTime } from '../../shared/types';

interface ResetRequest {
  id: number;
  identifier: string;
  kind: 'staff' | 'parent';
  status: 'pending' | 'processed';
  created_at: string;
}

/**
 * Admin xử lý yêu cầu quên mật khẩu (P0 red-team): user gửi yêu cầu từ màn
 * hình đăng nhập, admin xem danh sách tại đây, bấm "Đặt lại" để sinh mật khẩu
 * tạm rồi báo lại cho user qua kênh ngoài hệ thống (gọi điện, gặp trực tiếp).
 * Không có quyền users.view (403) thì ẩn hẳn section.
 */
export function ResetRequestsSection() {
  const { t } = useTranslation(['people', 'common']);
  const toast = useToast();
  const [rows, setRows] = useState<ResetRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [processing, setProcessing] = useState<ResetRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ name: string; pass: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ data: ResetRequest[] }>('/auth/reset-requests');
      setRows(res.data);
      setError(false);
    } catch {
      // 403 (không có quyền) hoặc lỗi mạng: ẩn section, không làm phiền admin
      setRows(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const process = async () => {
    if (!processing || busy) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; tempPassword: string }>(
        `/auth/reset-requests/${processing.id}/process`,
        { method: 'POST' }
      );
      setTempPassword({ name: processing.identifier, pass: res.tempPassword });
      setProcessing(null);
      void load();
    } catch (err) {
      toastApiError(toast, err, t('reset.processError'));
    } finally {
      setBusy(false);
    }
  };

  // ADM-12: modal mật khẩu tạm phải sống qua lần tải lại (skeleton/lỗi) — server đã đổi mật khẩu rồi,
  // mất modal là admin không còn cách nào xem lại mật khẩu tạm.
  const tempModal = tempPassword && (
    <Modal title={t('reset.doneTitle')} onClose={() => setTempPassword(null)}>
      <p className="muted">{t('reset.doneDesc', { name: tempPassword.name })}</p>
      <p className="temp-password">
        <code>{tempPassword.pass}</code>
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={() => setTempPassword(null)}>
          {t('actions.close', { ns: 'common' })}
        </button>
      </div>
    </Modal>
  );

  if (error) return tempModal || null;
  if (loading || rows === null) {
    return (
      <section className="reset-requests" aria-labelledby="reset-requests-title">
        <h2 id="reset-requests-title">{t('reset.title')}</h2>
        <TableSkeleton cols={4} />
        {tempModal}
      </section>
    );
  }

  const pending = rows.filter((r) => r.status === 'pending');

  return (
    <section className="reset-requests" aria-labelledby="reset-requests-title">
      <h2 id="reset-requests-title">{t('reset.title')}</h2>
      <p className="muted">{t('reset.desc')}</p>
      {pending.length === 0 ? (
        <EmptyState icon="key" title={t('reset.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th scope="col">{t('reset.identifier')}</th>
                <th scope="col">{t('reset.kind')}</th>
                <th scope="col">{t('reset.requestedAt')}</th>
                <th scope="col">
                  <span className="sr-only">{t('table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.identifier}</td>
                  <td data-label={t('reset.kind')}>
                    {r.kind === 'staff' ? t('reset.kindStaff') : t('reset.kindParent')}
                  </td>
                  <td data-label={t('reset.requestedAt')}>{formatDateTime(r.created_at)}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-inline" onClick={() => setProcessing(r)}>
                      <Icon name="key" size={14} />
                      {t('reset.process')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {processing && (
        <ConfirmDialog
          title={t('reset.confirmTitle', { name: processing.identifier })}
          message={t('reset.confirmMessage')}
          onClose={() => setProcessing(null)}
          onConfirm={process}
        />
      )}
      {tempModal}
    </section>
  );
}
