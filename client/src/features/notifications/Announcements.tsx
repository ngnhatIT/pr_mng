import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination } from '../../shared/components/Pagination';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { Modal } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/icons';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { formatDateTime } from '../../shared/types';
import { useMyPermissions } from '../system/roles.api';
import { classesApi } from '../classes/classes.api';
import { announcementsApi } from './notifications.api';

/** Thông báo chung gửi phụ huynh (toàn trung tâm hoặc 1 lớp) + lịch sử đã gửi. */
export function Announcements() {
  const { t } = useTranslation(['ops', 'common']);
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const [composing, setComposing] = useState(false);
  const canSend = useMyPermissions().has('notifications.send');
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => announcementsApi.list(page), [page]);
  useEffect(() => {
    if (error) toastApiError(toast, error, t('announcements.loadError'));
  }, [error, toast, t]);

  return (
    <div className="page">
      <PageHeader
        title={t('announcements.title')}
        desc={t('announcements.desc')}
        actions={
          canSend && (
            <button className="btn btn-primary btn-inline" onClick={() => setComposing(true)}>
              <Icon name="send" size={14} />
              {t('announcements.compose')}
            </button>
          )
        }
      />
      {loading && !data ? (
        <TableSkeleton cols={4} />
      ) : error && !data ? (
        <LoadError onRetry={reload} />
      ) : !data?.data.length ? (
        <EmptyState icon="send" title={t('announcements.emptyTitle')} desc={t('announcements.emptyDesc')} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th scope="col">{t('announcements.col.title')}</th>
                  <th scope="col">{t('announcements.col.audience')}</th>
                  <th scope="col" className="num">
                    {t('announcements.col.recipients')}
                  </th>
                  <th scope="col">{t('announcements.col.sent')}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a.id}>
                    <td data-label={t('announcements.col.title')}>
                      <strong>{a.title}</strong>
                      <div className="muted announce-body">{a.body}</div>
                    </td>
                    <td data-label={t('announcements.col.audience')}>
                      {a.class_name ?? t('announcements.allParents')}
                    </td>
                    <td data-label={t('announcements.col.recipients')} className="num">
                      {a.recipient_count}
                    </td>
                    <td data-label={t('announcements.col.sent')}>
                      {formatDateTime(a.created_at)}
                      {a.created_by_name && <div className="muted">{a.created_by_name}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            pagination={data.pagination}
            onChange={(p) => setQ({ page: String(p) })}
            loading={loading}
          />
        </>
      )}
      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            setQ({ page: '1' });
            reload();
          }}
        />
      )}
    </div>
  );
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, show, clear, refFor } = useFieldErrors<'title' | 'body'>();
  const { data: classes } = useLoad(() => classesApi.list('', { limit: 100 }), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<'title' | 'body', string>> = {};
    if (!title.trim()) errs.title = t('announcements.errors.title');
    if (!body.trim()) errs.body = t('announcements.errors.body');
    if (!show(errs)) return;
    setBusy(true);
    try {
      const r = await announcementsApi.create({
        title: title.trim(),
        body: body.trim(),
        ...(classId ? { class_id: Number(classId) } : {}),
      });
      toast(t('announcements.sent', { count: r.recipient_count }), 'success');
      onSent();
    } catch (err) {
      toastApiError(toast, err, t('announcements.sendError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('announcements.compose')} onClose={onClose} dirty={!!(title || body)}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('announcements.form.audience')} span>
            <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">{t('announcements.allParents')}</option>
              {(classes?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {t('announcements.classParents', { name: c.name })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('announcements.form.title')} span required error={errors.title}>
            <input
              className="text-input"
              maxLength={150}
              value={title}
              ref={refFor('title')}
              onChange={(e) => {
                setTitle(e.target.value);
                clear('title');
              }}
            />
          </Field>
          <Field label={t('announcements.form.body')} span required error={errors.body}>
            <textarea
              className="text-input"
              rows={6}
              maxLength={2000}
              value={body}
              ref={refFor('body')}
              onChange={(e) => {
                setBody(e.target.value);
                clear('body');
              }}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('announcements.send')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
