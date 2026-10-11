import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { parentApi } from './parent.api';
import { useToast } from '../../shared/ui/toast';
import { Icon } from '../../shared/components/icons';
import type { HomeworkItem } from '../../shared/types';
import './parent.css';

/** Phụ huynh nộp bài cho con: chụp ảnh bài làm hoặc đính kèm file + ghi chú. */
export function SubmitModal({
  homework,
  studentId,
  onClose,
  onDone,
}: {
  homework: HomeworkItem;
  studentId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['parent', 'common']);
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const { errors, show, clear } = useFieldErrors<'file'>();
  // FIX 7: khớp giới hạn server (server/src/shared/upload.ts:122)
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const submit = async () => {
    // Chưa chọn file lẫn chưa nhập ghi chú: báo inline dưới ô chọn file
    if (!file && !note.trim()) {
      show({ file: t('submit.fileOrNoteRequired') });
      return;
    }
    if (file && file.size > MAX_FILE_SIZE) {
      show({ file: t('submit.fileTooLarge') });
      return;
    }
    setBusy(true);
    setSubmitError(''); // file + ghi chú giữ nguyên, lỗi hiện ngay dưới nút nộp
    try {
      await parentApi.submitHomework(homework.id, studentId, file, note.trim());
      toast(t('submit.submitted'), 'success');
      onDone();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('submit.submitError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('submit.title', { title: homework.title })}
      onClose={onClose}
      dirty={!!file || note.trim() !== ''}
    >
      <Field label={t('submit.fileLabel')} error={errors.file}>
        <label className="file-drop">
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.mp3,.mp4"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (f && f.size > MAX_FILE_SIZE) {
                e.target.value = ''; // Cho chọn lại cùng file sau khi nén nhỏ
                setFile(null);
                show({ file: t('submit.fileTooLarge') });
                return;
              }
              setFile(f);
              clear('file');
            }}
          />
          <span className="file-drop-icon">
            <Icon name="upload" size={20} />
          </span>
          <span>
            <strong>{t('submit.chooseFile')}</strong>
            <br />
            <span className="muted-sm">{file ? t('submit.fileChosen') : t('submit.tapToChoose')}</span>
          </span>
        </label>
        {file && (
          <div className="file-chosen">
            <Icon name="paperclip" size={14} />
            <span>{file.name}</span>
          </div>
        )}
      </Field>
      <Field label={t('submit.noteLabel')}>
        <textarea
          className="text-input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('submit.notePlaceholder')}
        />
      </Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t('submit.submitting') : t('submit.submitAction')}
        </button>
      </div>
      {submitError && (
        <p className="field-error" role="alert" style={{ marginTop: 8 }}>
          {submitError}
        </p>
      )}
    </Modal>
  );
}
