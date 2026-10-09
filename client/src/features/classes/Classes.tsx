import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { classesApi, roomsApi, ClassItem, Room } from './classes.api';
import { peopleApi } from '../people/people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Teacher, ScheduleEntry, DAY_NAMES, formatVND } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './Classes.css';

interface ClassForm {
  name: string;
  teacher_id: string;
  room_id: string;
  schedule: ScheduleEntry[];
  start_date: string;
  end_date: string;
  tuition_fee: string;
  max_students: string;
  status: string;
}

export function Classes() {
  const { t } = useTranslation(['classes', 'common']);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ClassItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  /** Localized schedule text (shared formatScheduleText is Vietnamese-only) */
  const formatSchedule = (scheduleJson: string) => {
    try {
      const s: ScheduleEntry[] = JSON.parse(scheduleJson || '[]');
      return s.map((e) => `${t('days.' + e.day)} ${e.start}-${e.end}`).join(', ');
    } catch {
      return '';
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await classesApi.list({ page });
      setClasses(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: ClassForm, id?: number) => {
    try {
      const payload = {
        ...form,
        teacher_id: form.teacher_id ? Number(form.teacher_id) : null,
        room_id: form.room_id ? Number(form.room_id) : null,
        tuition_fee: Number(form.tuition_fee) || 0,
        max_students: Number(form.max_students) || 30,
      };
      if (id) await classesApi.update(id, payload);
      else await classesApi.create(payload);
      toast(t('toast.saved'), 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await classesApi.remove(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('title')}
        desc={t('desc')}
        actions={
          <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} />
            {t('add')}
          </button>
        }
      />

      {loading ? (
        <CardGridSkeleton />
      ) : classes.length === 0 ? (
        <EmptyState
          icon="book"
          title={t('empty.title')}
          desc={t('empty.desc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              {t('add')}
            </button>
          }
        />
      ) : (
        <div className="card-grid">
          {classes.map((c) => {
            const pct = c.max_students > 0 ? Math.min(100, Math.round((c.student_count / c.max_students) * 100)) : 0;
            const isFull = c.max_students > 0 && c.student_count >= c.max_students;
            return (
              <div key={c.id} className="card class-card card-hover">
                <div className="card-head">
                  <h2>
                    <Link className="link" to={`/app/classes/${c.id}`}>
                      {c.name}
                    </Link>
                  </h2>
                  <span className={`badge badge-${c.status}`}>
                    {t('classStatus.' + c.status)}
                  </span>
                </div>
                <dl className="dl dl-compact">
                  <dt>{t('table.teacher')}</dt>
                  <dd>{c.teacher_name || t('form.teacherUnassigned')}</dd>
                  <dt>{t('table.schedule')}</dt>
                  <dd>{formatSchedule(c.schedule || '') || '-'}</dd>
                  <dt>{t('table.fee')}</dt>
                  <dd className="num">{formatVND(c.tuition_fee)}</dd>
                  <dt>{t('table.size')}</dt>
                  <dd>
                    <span className="capacity-label">
                      <span className="num">
                        {c.student_count}/{c.max_students}
                      </span>
                      {isFull && (
                        <span className="badge badge-danger">{t('classes.full')}</span>
                      )}
                    </span>
                    <div
                      className={`capacity-meter${isFull ? ' is-full' : ''}`}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t('classes.capacityAria', { name: c.name, pct })}
                    >
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </dd>
                </dl>
                <div className="card-foot">
                  <Link className="btn btn-sm" to={`/app/classes/${c.id}`}>
                    {t('actions.detail', { ns: 'common' })}
                  </Link>
                  <button className="btn btn-sm" onClick={() => setEditing(c)}>
                    {t('actions.edit', { ns: 'common' })}
                  </button>
                  <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(c)}>
                    {t('actions.delete', { ns: 'common' })}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {editing && (
        <ClassFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.message', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function ClassFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: ClassItem | null;
  onClose: () => void;
  onSave: (form: ClassForm, id?: number) => Promise<void>;
}) {
  const { t } = useTranslation(['classes', 'common']);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [form, setForm] = useState<ClassForm>(() => ({
    name: initial?.name || '',
    teacher_id: initial?.teacher_id ? String(initial.teacher_id) : '',
    room_id: initial?.room_id ? String(initial.room_id) : '',
    schedule: initial ? JSON.parse(initial.schedule || '[]') : [],
    start_date: initial?.start_date || '',
    end_date: initial?.end_date || '',
    tuition_fee: initial ? String(initial.tuition_fee) : '',
    max_students: initial ? String(initial.max_students) : '30',
    status: initial?.status || 'active',
  }));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      peopleApi.listTeachers({ limit: 100 }).then((r) => r.data),
      roomsApi.list({ limit: 100 }).then((r) => r.data),
    ])
      .then(([t, r]) => {
        setTeachers(t);
        setRooms(r);
      })
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const set = (k: keyof ClassForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const addSlot = () => {
    setForm((f) => ({ ...f, schedule: [...f.schedule, { day: 2, start: '18:00', end: '20:00' }] }));
  };
  const updateSlot = (i: number, patch: Partial<ScheduleEntry>) => {
    setForm((f) => ({
      ...f,
      schedule: f.schedule.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  };
  const removeSlot = (i: number) => {
    setForm((f) => ({ ...f, schedule: f.schedule.filter((_, idx) => idx !== i) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSave(form, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? t('form.editTitle') : t('form.addTitle')} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('form.name')} span>
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label={t('form.teacher')}>
            <select className="text-input" value={form.teacher_id} onChange={set('teacher_id')}>
              <option value="">{t('form.teacherUnassigned')}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.status')}>
            <select className="text-input" value={form.status} onChange={set('status')}>
              <option value="active">{t('classStatus.active')}</option>
              <option value="inactive">{t('classStatus.inactive')}</option>
            </select>
          </Field>
          <Field label={t('form.room')}>
            <select className="text-input" value={form.room_id} onChange={set('room_id')}>
              <option value="">{t('form.roomNoAssign')}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.capacity != null ? t('form.roomCapacity', { capacity: r.capacity }) : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.startDate')}>
            <input className="text-input" type="date" value={form.start_date} onChange={set('start_date')} />
          </Field>
          <Field label={t('form.endDate')}>
            <input className="text-input" type="date" value={form.end_date} onChange={set('end_date')} />
          </Field>
          <Field label={t('form.tuitionFee')}>
            <input
              className="text-input"
              type="number"
              min={0}
              value={form.tuition_fee}
              onChange={set('tuition_fee')}
              required
            />
          </Field>
          <Field label={t('form.maxStudents')}>
            <input
              className="text-input"
              type="number"
              min={1}
              value={form.max_students}
              onChange={set('max_students')}
            />
          </Field>
        </div>

        <div className="schedule-editor">
          <div className="schedule-head">
            <span className="field-label">{t('form.weeklySchedule')}</span>
            <button type="button" className="btn btn-sm btn-inline" onClick={addSlot}>
              <Icon name="plus" size={13} />
              {t('form.addSlot')}
            </button>
          </div>
          {form.schedule.map((s, i) => (
            <div key={i} className="schedule-row">
              <select
                className="text-input"
                value={s.day}
                onChange={(e) => updateSlot(i, { day: Number(e.target.value) })}
              >
                {Object.keys(DAY_NAMES).map((d) => (
                  <option key={d} value={d}>
                    {t('days.' + d)}
                  </option>
                ))}
              </select>
              <input
                className="text-input"
                type="time"
                value={s.start}
                onChange={(e) => updateSlot(i, { start: e.target.value })}
              />
              <span className="muted">-</span>
              <input
                className="text-input"
                type="time"
                value={s.end}
                onChange={(e) => updateSlot(i, { end: e.target.value })}
              />
              <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => removeSlot(i)}>
                {t('actions.delete', { ns: 'common' })}
              </button>
            </div>
          ))}
          {form.schedule.length === 0 && (
            <p className="muted">{t('form.noSchedule')}</p>
          )}
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
