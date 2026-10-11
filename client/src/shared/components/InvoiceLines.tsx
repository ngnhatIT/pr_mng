import { useTranslation } from 'react-i18next';
import { formatVND, type InvoiceLine } from '../types';

/**
 * Bảng dòng hóa đơn + tạm tính + giảm trừ + phải thu (trang chi tiết và biên lai in).
 * Hóa đơn cũ không có dòng và không giảm trừ: không vẽ gì (giữ giao diện cũ).
 */
export function InvoiceLines({
  items,
  discount,
  discountReason,
  amount,
}: {
  items: InvoiceLine[];
  discount: number;
  discountReason?: string | null;
  amount: number;
}) {
  const { t } = useTranslation('tuition');
  if (!items.length && !discount) return null;
  const subtotal = amount + discount;
  return (
    <table className="table invoice-lines">
      <thead>
        <tr>
          <th scope="col">{t('lines.description')}</th>
          <th scope="col" className="num">
            {t('lines.quantity')}
          </th>
          <th scope="col" className="num">
            {t('lines.unitPrice')}
          </th>
          <th scope="col" className="num">
            {t('lines.lineTotal')}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.id ?? i}>
            <td>{it.description}</td>
            <td className="num">{it.quantity}</td>
            <td className="num">{formatVND(it.unit_price)}</td>
            <td className="num">{formatVND(it.quantity * it.unit_price)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>
            {t('lines.subtotal')}
          </th>
          <td className="num">{formatVND(subtotal)}</td>
        </tr>
        {discount > 0 && (
          <tr>
            <th scope="row" colSpan={3}>
              {discountReason
                ? t('lines.discountWithReason', { reason: discountReason })
                : t('lines.discount')}
            </th>
            <td className="num">−{formatVND(discount)}</td>
          </tr>
        )}
        <tr className="invoice-lines-total">
          <th scope="row" colSpan={3}>
            {t('lines.total')}
          </th>
          <td className="num">{formatVND(amount)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
