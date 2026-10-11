import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile } from '../api/client';
import { useToast, toastApiError } from '../ui/toast';
import { useMyPermissions } from '../../features/system/roles.api';
import { Icon } from './icons';
import { todayVN } from '../types';

/**
 * Nút "Xuất CSV" cho /exports/*.csv. Ẩn khi thiếu quyền reports.export.
 * query: filter đang áp dụng trên trang (giống API danh sách).
 */
export function ExportButton({
  kind,
  query = {},
}: {
  kind: 'students' | 'invoices' | 'debt' | 'payroll';
  query?: Record<string, string>;
}) {
  const { t, i18n } = useTranslation('common');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!useMyPermissions().has('reports.export')) return null;

  const run = async () => {
    setBusy(true);
    const qs = new URLSearchParams({
      ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)),
      lang: i18n.language.startsWith('en') ? 'en' : 'vi',
    });
    try {
      await downloadFile(`/exports/${kind}.csv?${qs}`, `${kind}-${todayVN()}.csv`);
    } catch (err) {
      toastApiError(toast, err, t('actions.exportError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn btn-ghost btn-inline" onClick={run} disabled={busy} aria-busy={busy}>
      <Icon name="download" size={14} />
      {t('actions.exportCsv')}
    </button>
  );
}
