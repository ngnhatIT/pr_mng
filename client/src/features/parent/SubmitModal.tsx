import { useState } from 'react';
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
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file && !note.trim()) {
      toast('Vui lòng chọn file hoặc nhập ghi chú', 'error');
      return;
    }
    setBusy(true);
    try {
      await parentApi.submitHomework(homework.id, studentId, file, note.trim());
      toast('Đã nộp bài', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Nộp bài thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Nộp bài - ${homework.title}`} onClose={onClose}>
      <Field label="Ảnh / file bài làm (jpg, png, pdf... tối đa 10MB)">
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
            <strong>Chụp ảnh hoặc chọn file</strong>
            <br />
            <span className="muted" style={{ fontSize: 13 }}>
              {file ? 'Đã chọn 1 file, bấm để đổi file khác' : 'Chạm để mở máy ảnh / thư viện'}
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
      <Field label="Ghi chú (không bắt buộc)">
        <textarea
          className="text-input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: Con đã làm xong trang 45-47..."
        />
      </Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Đang nộp...' : 'Nộp bài'}
        </button>
      </div>
    </Modal>
  );
}
