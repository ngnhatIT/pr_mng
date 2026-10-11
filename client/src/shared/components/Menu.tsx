import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Menu thả xuống theo mẫu WAI-ARIA menu button: Enter/Space/↓ mở và focus mục đầu, ↑/↓/Home/End di chuyển,
 * Esc đóng và trả focus về nút, Tab hoặc bấm ra ngoài thì đóng. Popup dùng position: fixed để không bị
 * `.table-wrap { overflow: auto }` cắt; cuộn/resize thì đóng thay vì bám theo.
 */
export function Menu({
  label,
  items,
  children,
  className = 'btn btn-sm btn-ghost btn-icon',
  align = 'end',
}: {
  /** Tên nút cho screen reader (nút thường chỉ có icon). */
  label: string;
  /** Mục `false`/`null` bị bỏ qua: viết `perms.has(x) && {...}` thay vì spread có điều kiện. */
  items: (MenuItem | false | null | undefined)[];
  /** Nội dung nút; mặc định icon ba chấm. */
  children?: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const visible = items.filter((it): it is MenuItem => !!it);

  const focusItem = (i: number) => {
    const els = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (!els?.length) return;
    els[(i + els.length) % els.length].focus();
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  // Tính vị trí trước khi vẽ: mở lên trên nếu phía dưới không đủ chỗ
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = listRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom;
    const vertical =
      below < h + 8 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 };
    const horizontal = align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left };
    setPos({ ...vertical, ...horizontal });
    focusItem(0);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') focusItem(i + 1);
    else if (e.key === 'ArrowUp') focusItem(i - 1);
    else if (e.key === 'Home') focusItem(0);
    else if (e.key === 'End') focusItem(-1);
    else if (e.key === 'Escape') {
      // Không để Esc lan lên Modal/drawer đang chứa menu
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
      return;
    } else return;
    e.preventDefault();
  };

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={className}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? <Icon name="more" size={16} />}
      </button>
      {open && (
        <div
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          className="menu-popup"
          style={pos}
          onKeyDown={onListKey}
        >
          {visible.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`menu-item${it.danger ? ' danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                // Trả focus về nút trước: modal mở từ đây sẽ trả focus về đúng nút khi đóng
                close(true);
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
