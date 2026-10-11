import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { lockScroll, unlockScroll } from '../scrollLock';

// Stack modal đang mở (để modal lồng nhau: chỉ modal trên cùng xử lý Escape)
const modalStack: HTMLDivElement[] = [];

// Liệt kê element focus được trong modal (bỏ qua element đang ẩn).
function getFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.getClientRects().length > 0);
}

/**
 * Modal dùng chung.
 * - Mở: focus field đầu tiên trong body (hoặc element có autoFocus), KHÔNG focus nút X (UX-1).
 * - Đóng (Esc / click nền / X): nếu `dirty` thì hỏi xác nhận bỏ thay đổi trước (UX-4); Esc khi đang gõ IME
 *   (Telex) chỉ hủy ghép chữ, không đóng modal (UX-11). Đóng xong trả focus về nút đã mở modal.
 * - `dirty` còn chặn reload/đóng tab (beforeunload) và bấm link/Back trong app (useBlocker ở app/App.tsx) khi đang mở.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  dirty,
  hideClose,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Form đã có thay đổi chưa lưu: đóng bằng Esc/nền/X sẽ hỏi xác nhận (nút Hủy của caller vẫn gọi thẳng onClose). */
  dirty?: boolean;
  /** Ẩn nút X (modal bắt buộc, vd: phải đổi mật khẩu). Caller tự cho onClose không làm gì để chặn Esc/nền. */
  hideClose?: boolean;
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Nhớ nút đã mở modal NGAY lúc render (trước commit): autoFocus của con chạy trong commit, sớm hơn effect.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement)
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // FE-1/ADM-16: caller thường truyền onClose là arrow inline -> giữ trong ref để effect setup (focus, stack,
  // khóa scroll) chỉ chạy 1 lần khi mount, không chạy lại mỗi lần parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedGuard(!!dirty);

  const requestClose = useCallback(() => {
    if (dirtyRef.current) setConfirmDiscard(true);
    else onCloseRef.current();
  }, []);

  useEffect(() => {
    const root = dialogRef.current;
    // Con đã tự focus (autoFocus) thì giữ nguyên; không thì focus control đầu tiên trong BODY (bỏ qua nút X ở head).
    // Màn cảm ứng: focus khung modal thay vì input để bàn phím ảo không bật lên che form.
    if (root && !root.contains(document.activeElement)) {
      const body = root.querySelector<HTMLElement>('.modal-body');
      const touch = window.matchMedia?.('(pointer: coarse)').matches;
      ((!touch && body && getFocusables(body)[0]) || root).focus();
    }
    // Đăng ký vào stack (modal mở sau = trên cùng)
    if (root) modalStack.push(root);
    // Khóa scroll nền khi modal mở (đặc biệt quan trọng trên mobile). Khóa đếm tham chiếu dùng chung với drawer,
    // không snapshot từng modal: modal + hộp xác nhận unmount cùng 1 commit vẫn mở khóa đúng (B-1, B3-1).
    lockScroll();

    const onKey = (e: KeyboardEvent) => {
      const root = dialogRef.current;
      // Chỉ modal trên cùng xử lý phím (modal lồng nhau: không đóng cả 2, mất dữ liệu form)
      if (!root || modalStack[modalStack.length - 1] !== root) return;
      if (e.key === 'Escape') {
        // Esc trong lúc gõ IME (Telex trên macOS/iOS) là hủy ghép chữ, không phải đóng modal
        if (e.isComposing || e.keyCode === 229) return;
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: giữ Tab/Shift+Tab xoay vòng trong modal.
      const focusables = getFocusables(root);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Gỡ khỏi stack khi unmount
      const idx = modalStack.indexOf(root as HTMLDivElement);
      if (idx >= 0) modalStack.splice(idx, 1);
      unlockScroll();
      // Trả focus về nút đã mở modal.
      try {
        opener?.focus?.();
      } catch {
        /* bỏ qua */
      }
    };
  }, [opener, requestClose]);

  return (
    <>
      {/* UX-3: chỉ đóng khi bấm đúng nền (không phải con/modal lồng nhau bubble lên qua cây React) */}
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`modal ${wide ? 'modal-wide' : ''}`}
        >
          <div className="modal-head">
            <div className="modal-title" id={titleId}>
              {title}
            </div>
            {!hideClose && (
              <button
                type="button"
                className="btn btn-icon modal-close"
                onClick={requestClose}
                aria-label={t('actions.close')}
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <div className="modal-body">{children}</div>
        </div>
      </div>
      {confirmDiscard && (
        <ConfirmDialog
          title={t('discard.title')}
          message={t('discard.message')}
          confirmLabel={t('discard.confirm')}
          danger
          onClose={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false);
            onCloseRef.current();
          }}
        />
      )}
    </>
  );
}

export function ConfirmDialog({
  title,
  message,
  onClose,
  onConfirm,
  danger,
  confirmLabel,
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  /** Nhãn nút xác nhận (mặc định "Xác nhận"). */
  confirmLabel?: string;
}) {
  const { t } = useTranslation('common');
  // Trạng thái đang thực thi: spinner trong nút + disabled, chống bấm 2 lần (skill 8.1)
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    // UX-11: đang chạy thì Esc/nền/X không đóng giữa chừng (giống nút Hủy đang disabled)
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <p className="confirm-text">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          {t('actions.cancel')}
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => void confirm()}
          disabled={busy}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {confirmLabel ?? t('actions.confirm')}
        </button>
      </div>
    </Modal>
  );
}
