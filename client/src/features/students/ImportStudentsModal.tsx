import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { studentsApi, type ImportResult } from './students.api';
import { rowsFromCsv, TEMPLATE_CSV, type ImportRow } from './studentImport';

const MAX_FILE_BYTES = 1024 * 1024;

/** Tải file mẫu (tạo tại client, không cần server). */
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'students-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Nhập học viên từ CSV: chọn file -> kiểm tra (dry run, lỗi theo dòng) -> nhập các dòng hợp lệ.
 * Nhận cả file Xuất CSV của chính app (tiêu đề tiếng Việt/Anh).
 */
export function ImportStudentsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['students', 'common']);
  const toast = useToast();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setRows(null);
    setCheck(null);
    setFileError('');
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setFileError(t('import.fileTooLarge'));
    const parsed = rowsFromCsv(await f.text());
    if (!parsed.hasName) return setFileError(t('import.noNameColumn'));
    if (!parsed.rows.length) return setFileError(t('import.empty'));
    setRows(parsed.rows);
    setUnknown(parsed.unknownColumns);
    setBusy(true);
    try {
      setCheck(await studentsApi.importRows(parsed.rows, true));
    } catch (err) {
      toastApiError(toast, err, t('import.checkError'));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await studentsApi.importRows(rows, false);
      toast(t('import.done', { count: r.created }), 'success');
      onDone();
    } catch (err) {
      toastApiError(toast, err, t('import.importError'));
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel = (f: string) => t(`import.fields.${f}`, { defaultValue: f });

  return (
    <Modal title={t('import.title')} onClose={onClose} wide dirty={!!rows}>
      <p className="muted">{t('import.desc')}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
        <Icon name="download" size={14} />
        {t('import.template')}
      </button>
      <div className="form-grid import-file">
        <Field label={t('import.file')} span error={fileError}>
          <input className="text-input" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e)} />
        </Field>
      </div>
      {busy && !check && (
        <p className="muted" role="status">
          <span className="spinner" aria-hidden="true" /> {t('import.checking')}
        </p>
      )}
      {check && (
        <div className="import-result" aria-live="polite">
          <p>
            {t('import.summary', {
              count: check.total,
              valid: check.valid,
              invalid: check.total - check.valid,
            })}
          </p>
          {unknown.length > 0 && <p className="muted">{t('import.ignored', { cols: unknown.join(', ') })}</p>}
          {check.errors.length > 0 && (
            <div className="table-wrap import-errors">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      {t('import.row')}
                    </th>
                    <th scope="col">{t('import.field')}</th>
                    <th scope="col">{t('import.problem')}</th>
                  </tr>
                </thead>
                <tbody>
                  {check.errors.slice(0, 200).map((e, i) => (
                    <tr key={i}>
                      <td className="num">{e.row}</td>
                      <td>{fieldLabel(e.field)}</td>
                      <td>{t(`import.errors.${e.code}`, { defaultValue: e.code })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !check || check.valid === 0}
          onClick={() => void commit()}
        >
          {busy && check && <span className="spinner" aria-hidden="true" />}
          {t('import.confirm', { count: check?.valid ?? 0 })}
        </button>
      </div>
    </Modal>
  );
}
