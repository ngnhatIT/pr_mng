import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { roomsApi, Room } from './classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
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
  const [busy, setBusy] = useState(false);
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
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await roomsApi.remove(deleting.id);
      toast(t('rooms.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    } finally {
      setBusy(false);
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
        <CardGridSkeleton count={4} />
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
        <div className="card-grid" aria-busy={loading || undefined}>
          {rooms.map((r) => (
            <article key={r.id} className="card room-card">
              <div className="room-card-head">
                <h3 className="room-card-name" title={r.name}>
                  {r.name}
                </h3>
                {(r.class_count ?? 0) > 0 ? (
                  <span className="badge badge-active">{t('rooms.status.inUse')}</span>
                ) : (
                  <span className="badge badge-idle">{t('rooms.status.idle')}</span>
                )}
              </div>
              <div className="room-card-meta">
                <div className="room-meta-row">
                  <Icon name="users" size={15} />
                  {t('rooms.table.capacity')}
                  <span className="room-meta-value">{r.capacity ?? '-'}</span>
                </div>
                <div className="room-meta-row">
                  <Icon name="calendar" size={15} />
                  {t('rooms.table.classesUsing')}
                  <span className="room-meta-value">{r.class_count ?? 0}</span>
                </div>
              </div>
              <div className="card-foot">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(r)}>
                  <Icon name="pencil" size={15} />
                  {t('actions.edit', { ns: 'common' })}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-ghost"
                  onClick={() => setDeleting(r)}
                >
                  <Icon name="trash" size={15} />
                  {t('actions.delete', { ns: 'common' })}
                </button>
              </div>
            </article>
          ))}
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
  const { errors, refFor, show, clear } = useFieldErrors<'name' | 'capacity'>();

  const validate = () => {
    const errs: { name?: string; capacity?: string } = {};
    if (!name.trim()) errs.name = t('rooms.form.errors.nameRequired');
    if (capacity.trim() && (!/^\d+$/.test(capacity.trim()) || Number(capacity) < 1))
      errs.capacity = t('rooms.form.errors.capacityInvalid');
    return show(errs);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate()) return;
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
          <Field label={t('rooms.form.name')} span error={errors.name}>
            <input
              className="text-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clear('name');
              }}
              ref={refFor('name')}
            />
          </Field>
          <Field label={t('rooms.form.capacity')} span error={errors.capacity}>
            <input
              className="text-input"
              type="number"
              min={1}
              step={1}
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value);
                clear('capacity');
              }}
              ref={refFor('capacity')}
              placeholder={t('rooms.form.capacityPlaceholder')}
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
