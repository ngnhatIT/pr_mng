import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import type { InvoiceItem } from '../../features/tuition/tuition.api';
import { formatVND } from '../../shared/types';

/**
 * Biên lai thu học phí — layout in A4.
 * Nút "In" gọi window.print(); CSS @media print ẩn sidebar/nav.
 */
export function ReceiptModal({
  invoice,
  centerName,
  onClose,
}: {
  invoice: InvoiceItem;
  centerName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('tuition');
  const today = new Date().toLocaleDateString(i18n.language === 'vi' ? 'vi-VN' : 'en-US');

  return (
    <Modal title={t('receipt.title')} onClose={onClose}>
      <div className="receipt">
        <div className="receipt-header">
          <h2>{centerName}</h2>
          <p>{t('receipt.subtitle')}</p>
        </div>
        <div className="receipt-body">
          <div className="kv">
            <span>{t('receipt.student')}</span>
            <strong>
              {invoice.student_name} ({invoice.student_code})
            </strong>
          </div>
          <div className="kv">
            <span>{t('receipt.class')}</span>
            <strong>{invoice.class_name || '-'}</strong>
          </div>
          <div className="kv">
            <span>{t('receipt.amount')}</span>
            <strong>{formatVND(invoice.amount)}</strong>
          </div>
          <div className="kv">
            <span>{t('receipt.paid')}</span>
            <strong>{formatVND(invoice.paid)}</strong>
          </div>
          <div className="kv">
            <span>{t('receipt.remaining')}</span>
            <strong>{formatVND(invoice.amount - invoice.discount - invoice.paid)}</strong>
          </div>
          {invoice.note && (
            <div className="kv">
              <span>{t('receipt.note')}</span>
              <strong>{invoice.note}</strong>
            </div>
          )}
        </div>
        <div className="receipt-footer">
          <div>
            <p>{t('receipt.date', { date: today })}</p>
            <p className="receipt-sign">{t('receipt.cashier')}</p>
          </div>
          <div>
            <p>&nbsp;</p>
            <p className="receipt-sign">{t('receipt.payer')}</p>
          </div>
        </div>
      </div>
      <div className="modal-actions no-print">
        <button type="button" className="btn" onClick={onClose}>
          {t('actions.close', { ns: 'common' })}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          {t('receipt.print')}
        </button>
      </div>
    </Modal>
  );
}
