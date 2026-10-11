import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../i18n';
import { InvoiceLines } from './InvoiceLines';

describe('InvoiceLines', () => {
  it('tạm tính lấy từ dòng; amount bị hoàn tiền giảm -> có dòng điều chỉnh, phải thu = amount', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      <InvoiceLines
        items={[{ description: 'Tuition', quantity: 1, unit_price: 2000000 }]}
        discount={200000}
        amount={1300000}
      />
    );
    expect(html).toContain('Subtotal</th><td class="num">2,000,000 VND');
    expect(html).toContain('Adjustment (refund)</th><td class="num">−500,000 VND');
    expect(html).toContain('Total due</th><td class="num">1,300,000 VND');
    await i18n.changeLanguage('vi');
  });
});
