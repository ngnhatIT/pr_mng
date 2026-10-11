import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/components/icons';
import { appLocale } from '../../shared/types';
import { inboxApi, type InAppNotification } from './notifications.api';
import { noticeText, timeAgo } from './notice';
import './NotificationBell.css';

const POLL_MS = 60_000;

/**
 * Chuông thông báo trên topbar (nhân sự, giáo viên, phụ huynh). Mẫu disclosure: nút aria-expanded mở panel,
 * Esc đóng và trả focus, bấm ra ngoài thì đóng. Số chưa đọc cập nhật mỗi 60s và khi quay lại tab.
 * allHref: trang xem đầy đủ (phụ huynh có trang riêng cho thông báo dài).
 */
export function NotificationBell({ allHref }: { allHref?: string }) {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refreshCount = useCallback(() => {
    inboxApi
      .unreadCount()
      .then((r) => setUnread(r.unread))
      .catch(() => {
        /* chuông không chặn trang: lỗi mạng thì giữ số cũ */
      });
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshCount();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refreshCount();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    inboxApi
      .list({ limit: 20 })
      .then((r) => {
        setItems(r.data);
        setUnread(r.unread);
      })
      .catch(() => setFailed(true));
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (n: InAppNotification) => {
    if (!n.read_at) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: 'now' } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
      void inboxApi.read(n.id).catch(() => refreshCount());
    }
    setOpen(false);
    const href = n.kind === 'announcement' && allHref ? allHref : n.link;
    if (href) void navigate(href);
  };

  const readAll = () => {
    setItems((prev) => prev?.map((x) => ({ ...x, read_at: x.read_at ?? 'now' })) ?? null);
    setUnread(0);
    void inboxApi.readAll().catch(() => refreshCount());
  };

  const locale = appLocale(i18n.language);
  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div className="notif" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-icon btn-ghost notif-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? t('notifications.bellUnread', { count: unread }) : t('notifications.bell')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" id={panelId} role="region" aria-label={t('notifications.title')}>
          <div className="notif-head">
            <strong>{t('notifications.title')}</strong>
            {unread > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={readAll}>
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          {failed ? (
            <p className="notif-empty">{t('notifications.loadError')}</p>
          ) : items === null ? (
            <p className="notif-empty">
              <span className="spinner" aria-hidden="true" /> {t('actions.loading')}
            </p>
          ) : items.length === 0 ? (
            <p className="notif-empty">{t('notifications.empty')}</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => {
                const { title, body } = noticeText(n, t);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`notif-item${n.read_at ? '' : ' is-unread'}`}
                      onClick={() => select(n)}
                    >
                      {!n.read_at && <span className="notif-dot" aria-label={t('notifications.unread')} />}
                      <span className="notif-text">
                        {title && <span className="notif-title">{title}</span>}
                        <span className="notif-body">{body}</span>
                        <span className="notif-time">{timeAgo(n.created_at, locale)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {allHref && (
            <button
              type="button"
              className="notif-all"
              onClick={() => {
                setOpen(false);
                void navigate(allHref);
              }}
            >
              {t('notifications.viewAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
