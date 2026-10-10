import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './RichTextarea';

/**
 * Khóa tính chất an toàn của renderMarkdown: escape HTML TRƯỚC khi áp
 * markdown. Đảo thứ tự 2 bước này là thành stored XSS ngay (output đi vào
 * dangerouslySetInnerHTML ở ChildDetail).
 */
describe('renderMarkdown - escape trước, markdown sau', () => {
  it('vô hiệu hoá thẻ script chèn vào', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('vô hiệu hoá thẻ img với onerror', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('markdown trong nội dung độc vẫn render an toàn', () => {
    const out = renderMarkdown('**<b>đậm</b>**');
    expect(out).toBe('<strong>&lt;b&gt;đậm&lt;/b&gt;</strong>');
  });

  it('ký tự & của user không bị double-escape thành tag', () => {
    const out = renderMarkdown('a & b');
    expect(out).toBe('a &amp; b');
  });

  it('markdown thường vẫn hoạt động', () => {
    expect(renderMarkdown('**đậm**')).toBe('<strong>đậm</strong>');
    expect(renderMarkdown('*nghiêng*')).toBe('<em>nghiêng</em>');
    expect(renderMarkdown('## Tiêu đề')).toBe('<strong class="md-h">Tiêu đề</strong>');
    expect(renderMarkdown('> trích')).toBe('<blockquote>trích</blockquote>');
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li>\n<li>b</li></ul>');
  });
});
