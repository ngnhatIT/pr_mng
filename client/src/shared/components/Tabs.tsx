import type { KeyboardEvent, ReactNode } from 'react';

/**
 * B5-3: tab theo mẫu WAI-ARIA (tablist/tab/aria-selected/aria-controls, roving tabIndex, phím ←/→/Home/End
 * chuyển + chọn tab). Nội dung tab bọc bằng {...tabPanelProps(id, value)}.
 */
export function Tabs<K extends string>({
  id,
  tabs,
  value,
  onChange,
  label,
  className = '',
}: {
  /** Tiền tố id duy nhất trong trang (nối tab <-> panel). */
  id: string;
  tabs: { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((tb) => tb.key === value);
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    document.getElementById(`${id}-tab-${tabs[next].key}`)?.focus();
  };
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tb) => (
        <button
          key={tb.key}
          type="button"
          role="tab"
          id={`${id}-tab-${tb.key}`}
          aria-selected={tb.key === value}
          aria-controls={`${id}-panel`}
          tabIndex={tb.key === value ? 0 : -1}
          className={`tab${tb.key === value ? ' active' : ''}`}
          onClick={() => onChange(tb.key)}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export const tabPanelProps = (id: string, value: string) => ({
  role: 'tabpanel' as const,
  id: `${id}-panel`,
  'aria-labelledby': `${id}-tab-${value}`,
});
