import { useRef } from 'react';

/**
 * Editor nội dung bài tập với thanh công cụ markdown:
 * in đậm, in nghiêng, danh sách, tiêu đề — giáo viên soạn đề đẹp như Classroom.
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
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after = '') => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end) || 'nội dung';
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

  const tools: { label: string; title: string; fn: () => void }[] = [
    { label: 'B', title: 'In đậm', fn: () => wrap('**', '**') },
    { label: 'I', title: 'In nghiêng', fn: () => wrap('*', '*') },
    { label: 'H', title: 'Tiêu đề', fn: () => linePrefix('## ') },
    { label: '•', title: 'Danh sách', fn: () => linePrefix('- ') },
    { label: '1.', title: 'Danh sách số', fn: () => linePrefix('1. ') },
    { label: '❝', title: 'Trích dẫn', fn: () => linePrefix('> ') },
  ];

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        {tools.map((t) => (
          <button key={t.title} type="button" className="rich-tool" title={t.title} onClick={t.fn}>
            {t.label}
          </button>
        ))}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
          Hỗ trợ markdown
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<strong class="md-h">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
}
