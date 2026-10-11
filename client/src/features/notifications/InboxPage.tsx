import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { appLocale } from '../../shared/types';
import { inboxApi, INBOX_CHANGED } from './notifications.api';
import { noticeText, timeAgo } from './notice';
import './NotificationBell.css';

/** Trang đầy đủ thông báo của người đang đăng nhập (phụ huynh: đọc trọn thông báo chung dài). */
export function InboxPage() {
  const { t, i18n } = useTranslation('common');
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const { data, loading, error, reload, setData } = useLoad(() => inboxApi.list({ page }), [page]);
  const locale = appLocale(i18n.language);

  // Mở trang = đã xem các thông báo ĐANG HIỆN (không đánh dấu thông báo ở trang khác chưa xem)
  const shownKey = (data?.data ?? [])
    .filter((n) => !n.read_at)
    .map((n) => n.id)
    .join(',');
  useEffect(() => {
    if (!shownKey) return;
    const ids = shownKey.split(',').map(Number);
    void Promise.all(ids.map((id) => inboxApi.read(id)))
      .then(() => {
        setData(
          (d) => d && { ...d, data: d.data.map((n) => (ids.includes(n.id) ? { ...n, read_at: 'now' } : n)) }
        );
        window.dispatchEvent(new Event(INBOX_CHANGED));
      })
      .catch(() => {
        /* lần sau mở trang sẽ đánh dấu lại */
      });
  }, [shownKey, setData]);

  return (
    <div className="page">
      <PageHeader title={t('notifications.title')} />
      {loading && !data ? (
        <TableSkeleton cols={1} />
      ) : error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data?.data.length ? (
        <EmptyState icon="bell" title={t('notifications.empty')} />
      ) : (
        <>
          <ul className="notif-list inbox-list">
            {data.data.map((n) => {
              const { title, body } = noticeText(n, t);
              const content = (
                <span className="notif-text">
                  {title && <span className="notif-title">{title}</span>}
                  <span className="notif-body inbox-body">{body}</span>
                  <span className="notif-time">{timeAgo(n.created_at, locale)}</span>
                </span>
              );
              return (
                <li key={n.id} className="notif-item">
                  {n.link && n.kind !== 'announcement' ? <Link to={n.link}>{content}</Link> : content}
                </li>
              );
            })}
          </ul>
          <Pagination
            pagination={data.pagination}
            onChange={(p) => setQ({ page: String(p) })}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}
