import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeworkApi, uploadFile, UPLOAD_ACCEPT } from './homework.api';
import { HomeworkItem } from '../../shared/types';
import { Field } from '../../shared/components/Form';
import { Icon } from '../../shared/components/icons';
import {
  editAttachmentsPayload,
  isValidHttpUrl,
  pendingLink,
  validateLocalUpload,
  type Attachment,
  type HwFieldErrors,
} from './homeworkForm';

/** State + thao tác đính kèm (link + upload file) của form bài tập. */
export function useAttachments(initial: HomeworkItem | null, fe: HwFieldErrors) {
  const { t } = useTranslation(['homework', 'common']);
  const { errors, show, clear } = fe;
  // Đính kèm (YC1: hiện ở cả chế độ tạo và sửa; updateHomework đã đồng bộ)
  const [attachments, setAttachments] = useState<Attachment[]>(initial?.attachments ?? []);
  const [attName, setAttName] = useState('');
  const [attUrl, setAttUrl] = useState('');
  const attNameRef = useRef<HTMLInputElement>(null);
  const attUrlRef = useRef<HTMLInputElement>(null);
  // File đã upload trong phiên này nhưng chưa lưu bài (mồ côi nếu hủy modal)
  const orphanUrls = useRef<Set<string>>(new Set());
  // Upload file: tiến trình % + trạng thái đang tải
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Chế độ sửa: đánh dấu đã đụng vào đính kèm (cho dirty-check khi đóng modal)
  const [attDirty, setAttDirty] = useState(false);
  // Chế độ sửa: trạng thái tải đính kèm hiện có. Chưa 'ok' thì khóa thêm/gỡ và không gửi attachments.
  const [attLoad, setAttLoad] = useState<'loading' | 'ok' | 'error'>(initial ? 'loading' : 'ok');

  // Chế độ sửa: tải đính kèm hiện có của bài tập (danh sách không trả kèm attachments).
  // Thêm/gỡ bị khóa tới khi tải xong nên không có thay đổi nào của user bị ghi đè.
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    homeworkApi
      .get(initial.id)
      .then((hw) => {
        if (cancelled) return;
        setAttachments(hw.attachments ?? []);
        setAttLoad('ok');
      })
      .catch(() => {
        if (!cancelled) setAttLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const addAttachment = () => {
    // P1-4: mọi lỗi thêm đính kèm báo inline dưới cụm đính kèm (đúng pattern useFieldErrors), không toast
    const name = attName.trim();
    const url = attUrl.trim();
    if (!name) {
      show({ ...errors, attachment: t('form.errors.attRequired') });
      attNameRef.current?.focus();
      return;
    }
    if (!url) {
      show({ ...errors, attachment: t('form.errors.attRequired') });
      attUrlRef.current?.focus();
      return;
    }
    // P0-3: URL phải đúng định dạng http/https
    if (!isValidHttpUrl(url)) {
      show({ ...errors, attachment: t('form.errors.attUrlInvalid') });
      attUrlRef.current?.focus();
      return;
    }
    setAttachments((a) => [...a, { name, url, kind: 'link' }]);
    setAttName('');
    setAttUrl('');
    if (initial) setAttDirty(true);
    clear('attachment');
  };

  /** Xóa đính kèm khỏi danh sách (chưa lưu DB).
   * File vừa upload trong phiên này mà bị gỡ → xóa ngay trên server để khỏi mồ côi.
   * File đã lưu từ trước mà bị gỡ → server dọn khi lưu bài (syncAttachments). */
  const removeAttachment = (i: number) => {
    // Side effect (xóa file) nằm ngoài setState updater: StrictMode gọi updater 2 lần
    const a = attachments[i];
    if (a && a.kind === 'file' && orphanUrls.current.has(a.url)) {
      orphanUrls.current.delete(a.url);
      const filename = a.url.split('/').pop() || '';
      homeworkApi.deleteUpload(filename).catch(() => {});
    }
    setAttachments((list) => list.filter((_, j) => j !== i));
    if (initial) setAttDirty(true);
    clear('attachment');
  };

  /** Chọn file từ máy → validate client → upload qua XHR (có % tiến trình) → thêm vào đính kèm. */
  const handleFileSelect = async (file: File | undefined) => {
    if (!file || uploading) return;
    const problem = validateLocalUpload(file.name, file.size);
    if (problem === 'size') {
      show({ ...errors, attachment: t('form.errors.attTooBig') });
      return;
    }
    if (problem === 'type') {
      show({ ...errors, attachment: t('form.errors.attTypeInvalid') });
      return;
    }
    setUploading(true);
    setUploadPct(0);
    clear('attachment');
    try {
      const up = await uploadFile(file, setUploadPct);
      setAttachments((a) => [...a, { name: up.name, url: up.url, kind: 'file' }]);
      orphanUrls.current.add(up.url); // chưa lưu bài → mồ côi nếu hủy modal
      if (initial) setAttDirty(true);
    } catch (err) {
      show({ ...errors, attachment: err instanceof Error ? err.message : t('form.errors.attUploadFailed') });
    } finally {
      setUploading(false);
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** B4-1: lỗi của link gõ dở (dùng trong validate của form) hoặc undefined. */
  const pending = pendingLink(attName, attUrl);
  const pendingError = (): string | undefined => {
    if (!pending) return undefined;
    if ('error' in pending) return t(`form.errors.${pending.error}`);
    // Sửa bài mà chưa tải được đính kèm hiện có: không gửi attachments -> link sẽ mất, chặn luôn
    return attLoad === 'ok' ? undefined : t('form.errors.attPendingLocked');
  };
  /** B4-1: lúc lưu bài, link gõ dở hợp lệ được tự thêm. Trả danh sách đính kèm sẽ gửi đi. */
  const commitPending = (): Attachment[] => {
    if (!pending || 'error' in pending) return attachments;
    const next = [...attachments, pending.link];
    setAttachments(next);
    setAttName('');
    setAttUrl('');
    if (initial) setAttDirty(true);
    return next;
  };

  /** Dọn file mồ côi đã upload trong phiên này (khi hủy modal). Best-effort, không chặn đóng. */
  const cleanupOrphans = useCallback(() => {
    for (const url of orphanUrls.current) {
      const filename = url.split('/').pop() || '';
      homeworkApi.deleteUpload(filename).catch(() => {});
    }
    orphanUrls.current.clear();
  }, []);
  /** Đính kèm đã gắn vào bài (lưu thành công) → không còn mồ côi. */
  const markSaved = () => orphanUrls.current.clear();

  return {
    attachments,
    attName,
    setAttName,
    attUrl,
    setAttUrl,
    attNameRef,
    attUrlRef,
    uploadPct,
    uploading,
    fileInputRef,
    attDirty,
    attLoad,
    addAttachment,
    removeAttachment,
    handleFileSelect,
    cleanupOrphans,
    markSaved,
    pendingError,
    commitPending,
    /** Đính kèm gửi khi SỬA bài (undefined = server giữ nguyên). */
    editPayload: (list: Attachment[]) => editAttachmentsPayload(attLoad, list),
  };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

/** Cụm đính kèm: danh sách, nút tải file (có % tiến trình), thêm link. */
export function AttachmentsField({
  att,
  error,
  busy,
}: {
  att: AttachmentsState;
  error?: string;
  busy: boolean;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const { attachments, attLoad, uploading, uploadPct, fileInputRef } = att;
  return (
    <Field
      label={t('form.attachments')}
      error={error ?? (attLoad === 'error' ? t('form.attLoadFailed') : undefined)}
      group
    >
      {attachments.map((a, i) => (
        <div key={i} className="att-row">
          <Icon name={a.kind === 'file' ? 'file' : 'paperclip'} size={14} />
          <span>{a.name}</span>
          <span className="muted hw-text-12">{a.url.slice(0, 40)}...</span>
          <button
            type="button"
            className="btn btn-sm btn-danger-ghost"
            onClick={() => att.removeAttachment(i)}
            disabled={attLoad !== 'ok'}
            aria-label={t('form.removeAttachment', { name: a.name })}
          >
            {t('actions.delete', { ns: 'common' })}
          </button>
        </div>
      ))}
      {/* Tải file từ máy (YC1) */}
      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hw-hidden-input"
        aria-label={t('form.uploadFile')}
        onChange={(e) => void att.handleFileSelect(e.target.files?.[0])}
      />
      <div className="hw-flex-wrap">
        <button
          type="button"
          className="btn hw-action-icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || busy || attLoad !== 'ok'}
        >
          {uploading && <span className="spinner spinner-dark" aria-hidden="true" />}
          <Icon name="upload" size={16} />
          {uploading && uploadPct !== null
            ? t('form.uploadingPct', { pct: uploadPct })
            : t('form.uploadFile')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={att.addAttachment}
          disabled={uploading || busy || attLoad !== 'ok'}
        >
          {t('form.addAttachment')}
        </button>
      </div>
      {uploading && uploadPct !== null && (
        <div
          className="upload-row"
          role="progressbar"
          aria-valuenow={uploadPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="upload-track">
            <div className="upload-fill" style={{ width: `${uploadPct}%` }} />
          </div>
          <span className="upload-pct">{uploadPct}%</span>
        </div>
      )}
      <div className="muted hw-text-12 hw-mt-8">{t('form.uploadHint')}</div>
      <div className="hw-flex-wrap hw-mt-8">
        <input
          ref={att.attNameRef}
          className="text-input"
          placeholder={t('form.attNamePh')}
          value={att.attName}
          onChange={(e) => att.setAttName(e.target.value)}
        />
        <input
          ref={att.attUrlRef}
          className="text-input"
          placeholder={t('form.attUrlPh')}
          value={att.attUrl}
          onChange={(e) => att.setAttUrl(e.target.value)}
        />
      </div>
    </Field>
  );
}
