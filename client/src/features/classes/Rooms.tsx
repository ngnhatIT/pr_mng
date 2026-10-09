import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { roomsApi, Room } from './classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import './Rooms.css';

export function Rooms() {
  const { t } = useTranslation(['classes', 'common']);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Room | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await roomsApi.list({ page });
      setRooms(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('rooms.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: { name: string; capacity: string }, id?: number) => {
    try {
      const payload = { name: form.name, capacity: form.capacity ? Number(form.capacity) : null };
      if (id) await roomsApi.update(id, payload);
      else await roomsApi.create(payload);
      toast(t('rooms.saved'), 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await roomsApi.remove(deleting.id);
      toast(t('rooms.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('rooms.title')}
        desc={t('rooms.desc')}
        actions={
          <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} />
            {t('rooms.add')}
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={4} />
      ) : rooms.length === 0 ? (
        <EmptyState
          icon="building"
          title={t('rooms.empty.title')}
          desc={t('rooms.empty.desc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              {t('rooms.add')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <th scope="col"ead>
              <tr>
                <th scope="col">{t('rooms.table.name')}</th>
                <th scope="col">{t('rooms.table.capacity')}</th>
                <th scope="col">{t('rooms.table.classesUsing')}</th>
                <th scope="col">{t('rooms.table.status')}</th>
                <th scope="col" className="th-right">{t('rooms.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td className="room-name">{r.name}</td>
                  <td className="num">{r.capacity ?? '-'}</td>
                  <td className="num">{r.class_count ?? 0}</td>
                  <td>
                    {(r.class_count ?? 0) > 0 ? (
                      <span className="badge badge-active">{t('rooms.status.inUse')}</span>
                    ) : (
                      <span className="badge badge-idle">{t('rooms.status.idle')}</span>
                    )}
                  </td>
                  <td className="td-right">
                    <span className="row-actions">
                      <button className="btn btn-sm btn-inline" onClick={() => setEditing(r)}>
                        <Icon name="pencil" size={13} />
                        {t('actions.edit', { ns: 'common' })}
                      </button>
                      <button
                        className="btn btn-sm btn-inline btn-danger-ghost"
                        onClick={() => setDeleting(r)}
                      >
                        <Icon name="trash" size={13} />
                        {t('actions.delete', { ns: 'common' })}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {editing && (
        <RoomFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('rooms.delete.title')}
          message={t('rooms.delete.message', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function RoomFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Room | null;
  onClose: () => void;
  onSave: (form: { name: string; capacity: string }, id?: number) => Promise<void>;
}) {
  const { t } = useTranslation(['classes', 'common']);
  const [name, setName] = useState(initial?.name || '');
  const [capacity, setCapacity] = useState(initial?.capacity ? String(initial.capacity) : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSave({ name, capacity }, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? t('rooms.form.editTitle') : t('rooms.form.addTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('rooms.form.name')} span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('rooms.form.capacity')} span>
            <input
              className="text-input"
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder={t('rooms.form.capacityPlaceholder')}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
