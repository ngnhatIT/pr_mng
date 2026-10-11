// @vitest-environment happy-dom
import { useState } from 'react';
import { act } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { $, $$, cleanup, renderPage } from '../../test-utils';
import { Tabs, tabPanelProps } from './Tabs';

function Demo() {
  const [v, setV] = useState('');
  return (
    <>
      <Tabs
        id="t"
        label="Trạng thái"
        tabs={['', 'a', 'b'].map((key) => ({ key, label: key || 'all' }))}
        value={v}
        onChange={setV}
      />
      <div {...tabPanelProps('t', v)} />
    </>
  );
}

const key = async (k: string) =>
  act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
const selected = () => $('[role="tab"][aria-selected="true"]')!.id;

afterEach(cleanup);

describe('Tabs (B6-4)', () => {
  it('tablist có tên; key rỗng -> id "-tab-all"; ←/→ (vòng), Home/End chọn + chuyển focus, roving tabIndex', async () => {
    await renderPage(<Demo />);
    expect($('[role="tablist"]')!.getAttribute('aria-label')).toBe('Trạng thái');
    expect($$('[role="tab"]').map((b) => b.id)).toEqual(['t-tab-all', 't-tab-a', 't-tab-b']);
    expect($('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('t-tab-all');
    $<HTMLElement>('#t-tab-all')!.focus();
    for (const [k, want] of [
      ['ArrowRight', 't-tab-a'],
      ['End', 't-tab-b'],
      ['ArrowRight', 't-tab-all'],
      ['ArrowLeft', 't-tab-b'],
      ['Home', 't-tab-all'],
    ]) {
      await key(k);
      expect([selected(), document.activeElement!.id]).toEqual([want, want]);
      expect($$('[role="tab"]').map((b) => b.tabIndex)).toEqual(
        ['t-tab-all', 't-tab-a', 't-tab-b'].map((id) => (id === want ? 0 : -1))
      );
    }
    await key('x'); // phím khác: không đổi
    expect(selected()).toBe('t-tab-all');
  });
});
