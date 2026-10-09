import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Editor nội dung bài tập với thanh công cụ markdown:
 * in đậm, in nghiêng, danh sách, tiêu đề - giáo viên soạn đề đẹp như Classroom.
 */
export function RichTextarea({
  value,
  onChange,
  rows = 5,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const { t } = useTranslation(['homework', 'common']);
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after = '') => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end) || t('editor.selFallback');
    const next = value.slice(0, start) + before + sel + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  };

  const linePrefix = (prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const tools: { label: ReactNode; title: string; fn: () => void }[] = [
    { label: 'B', title: t('editor.bold'), fn: () => wrap('**', '**') },
    { label: 'I', title: t('editor.italic'), fn: () => wrap('*', '*') },
    { label: 'H', title: t('editor.heading'), fn: () => linePrefix('## ') },
    { label: '•', title: t('editor.bullets'), fn: () => linePrefix('- ') },
    { label: '1.', title: t('editor.numbered'), fn: () => linePrefix('1. ') },
    {
      label: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 7h4v4c0 2.8-1.8 3.9-3 4.6l-1.2-1.4c.7-.4 1.2-.9 1.2-1.7H7V7zm9 0h4v4c0 2.8-1.8 3.9-3 4.6l-1.2-1.4c.7-.4 1.2-.9 1.2-1.7h-1V7z" />
        </svg>
      ),
      title: t('editor.quote'),
      fn: () => linePrefix('> '),
    },
  ];

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        {tools.map((tool) => (
          <button key={tool.title} type="button" className="rich-tool" title={tool.title} onClick={tool.fn}>
            {tool.label}
          </button>
        ))}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {t('editor.markdownHint')}
        </span>
      </div>
      <textarea
        ref={ref}
        className="text-input"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

/** Render markdown đơn giản cho nội dung bài tập (bold/italic/list/quote/heading). */
export function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<strong class="md-h">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
}
