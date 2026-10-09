import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
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

  const submit = async () => {
    if (!file && !note.trim()) {
      toast(t('submit.fileOrNoteRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await parentApi.submitHomework(homework.id, studentId, file, note.trim());
      toast(t('submit.submitted'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('submit.submitError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('submit.title', { title: homework.title })} onClose={onClose}>
      <Field label={t('submit.fileLabel')}>
        <label className="file-drop">
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.mp3,.mp4"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="file-drop-icon">
            <Icon name="upload" size={20} />
          </span>
          <span>
            <strong>{t('submit.chooseFile')}</strong>
            <br />
            <span className="muted" style={{ fontSize: 13 }}>
              {file ? t('submit.fileChosen') : t('submit.tapToChoose')}
            </span>
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
          {busy ? t('submit.submitting') : t('submit.submitAction')}
        </button>
      </div>
    </Modal>
  );
}
