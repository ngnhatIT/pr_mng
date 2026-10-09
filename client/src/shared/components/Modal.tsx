import { ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';

// Stack modal đang mở (để modal lồng nhau: chỉ modal trên cùng xử lý Escape)
const modalStack: HTMLDivElement[] = [];

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Nhớ element đang focus để trả lại khi đóng modal.
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Chuyển focus vào modal khi mở.
    dialogRef.current?.focus();
    // Đăng ký vào stack (modal mở sau = trên cùng)
    const root = dialogRef.current;
    if (root) modalStack.push(root);
    // Khóa scroll nền khi modal mở (đặc biệt quan trọng trên mobile).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Chỉ modal trên cùng (topmost) được đóng bằng Escape
        // (tránh modal lồng nhau bị đóng cả 2, mất dữ liệu form)
        const root = dialogRef.current;
        if (root && modalStack[modalStack.length - 1] === root) {
          onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: giữ Tab/Shift+Tab xoay vòng trong modal.
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.getClientRects().length > 0);
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
      document.body.style.overflow = prevOverflow;
      // Trả focus về nút đã mở modal.
      try {
        previouslyFocused.current?.focus?.();
      } catch {
        /* bỏ qua */
      }
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title" id={titleId}>
            {title}
          </div>
          <button className="btn btn-icon modal-close" onClick={onClose} aria-label={t('actions.close')}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  onClose,
  onConfirm,
  danger,
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-text">{message}</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          {t('actions.cancel')}
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => {
            void Promise.resolve(onConfirm());
          }}
        >
          {t('actions.confirm')}
        </button>
      </div>
    </Modal>
  );
}
