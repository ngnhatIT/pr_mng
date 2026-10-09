import { ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
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
