import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n';
import { ReceiptModal } from './ReceiptModal';
import { formatVND } from '../types';

const base = { student_name: 'An', student_code: 'HV1', class_name: 'L1', amount: 2_000_000, note: null };

describe('ReceiptModal (CORR-2 / ADM-4)', () => {
  it('còn lại = amount − paid, không NaN, ngày đã nội suy', () => {
    const html = renderToStaticMarkup(
      <ReceiptModal invoice={{ ...base, paid: 500_000 }} centerName="TT" onClose={() => {}} />
    );
    expect(html).toContain(formatVND(1_500_000));
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('{');
    expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('paid thiếu (InvoiceDetail) -> coi như 0', () => {
    const html = renderToStaticMarkup(<ReceiptModal invoice={base} centerName="TT" onClose={() => {}} />);
    expect(html).toContain(formatVND(2_000_000));
    expect(html).not.toContain('NaN');
  });
});
