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
import { inboxApi } from './notifications.api';
import { noticeText, timeAgo } from './notice';
import './NotificationBell.css';

/** Trang đầy đủ thông báo của người đang đăng nhập (phụ huynh: đọc trọn thông báo chung dài). */
export function InboxPage() {
  const { t, i18n } = useTranslation('common');
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const { data, loading, error, reload, setData } = useLoad(() => inboxApi.list({ page }), [page]);
  const locale = appLocale(i18n.language);

  // Mở trang = đã xem các thông báo đang hiện
  useEffect(() => {
    if (!data?.unread) return;
    void inboxApi
      .readAll()
      .then(() =>
        setData(
          (d) => d && { ...d, unread: 0, data: d.data.map((n) => ({ ...n, read_at: n.read_at ?? 'now' })) }
        )
      );
  }, [data?.unread, setData]);

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
