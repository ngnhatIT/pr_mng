import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { Icon, type IconName } from './icons';
import { useDebounce } from '../hooks/useDebounce';
import { headerKey } from '../csv';
import { studentsApi } from '../../features/students/students.api';
import { classesApi } from '../../features/classes/classes.api';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  to: string;
  group: 'pages' | 'students' | 'classes';
}

/** Khớp không dấu, không phân biệt hoa thường ("hoc phi" khớp "Học phí"). */
const norm = (s: string) => headerKey(s);

/**
 * Tìm nhanh (Ctrl/Cmd+K): đi tới trang + tìm học viên/lớp theo tên/mã. Mẫu combobox + listbox:
 * ↑/↓ chọn, Enter mở, Esc đóng (Modal lo focus trap + trả focus).
 */
export function CommandPalette({
  pages,
  canSearch,
  onClose,
}: {
  pages: { to: string; label: string; icon: IconName }[];
  canSearch: { students: boolean; classes: boolean };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<PaletteItem[]>([]);
  const dq = useDebounce(q.trim(), 250);

  useEffect(() => {
    if (dq.length < 2) {
      setRemote([]);
      return;
    }
    let alive = true;
    const swallow = <T,>(p: Promise<T>) => p.catch(() => null);
    void Promise.all([
      canSearch.students ? swallow(studentsApi.list(dq, '', { limit: 5 })) : null,
      canSearch.classes ? swallow(classesApi.list(dq, { limit: 5 })) : null,
    ]).then(([st, cl]) => {
      if (!alive) return;
      setRemote([
        ...(st?.data ?? []).map((s) => ({
          id: `s${s.id}`,
          label: s.name,
          hint: s.code,
          icon: 'user' as IconName,
          to: `/app/students/${s.id}`,
          group: 'students' as const,
        })),
        ...(cl?.data ?? []).map((c) => ({
          id: `c${c.id}`,
          label: c.name,
          icon: 'book' as IconName,
          to: `/app/classes/${c.id}`,
          group: 'classes' as const,
        })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [dq, canSearch.students, canSearch.classes]);

  const items = useMemo(() => {
    const k = norm(q);
    const pageItems: PaletteItem[] = pages
      .filter((p) => !k || norm(p.label).includes(k))
      .map((p) => ({ id: `p${p.to}`, label: p.label, icon: p.icon, to: p.to, group: 'pages' }));
    return [...pageItems.slice(0, k ? 6 : 8), ...remote];
  }, [q, pages, remote]);

  useEffect(() => setActive(0), [q, remote]);

  const go = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    void navigate(it.to);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[active]);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  let lastGroup = '';

  return (
    <Modal title={t('palette.title')} onClose={onClose}>
      <div className="palette">
        <div className="search-wrap">
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(active) : undefined}
            aria-label={t('palette.placeholder')}
            placeholder={t('palette.placeholder')}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <ul className="palette-list" id={listId} role="listbox" aria-label={t('palette.title')}>
          {items.map((it, i) => {
            const head = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {head && (
                  <div className="palette-group" aria-hidden="true">
                    {t(`palette.groups.${it.group}`)}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(it)}
                >
                  <Icon name={it.icon} size={16} />
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint mono">{it.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        {items.length === 0 && <p className="palette-empty">{t('palette.empty')}</p>}
        <p className="palette-foot muted" aria-hidden="true">
          {t('palette.keys')}
        </p>
      </div>
    </Modal>
  );
}
