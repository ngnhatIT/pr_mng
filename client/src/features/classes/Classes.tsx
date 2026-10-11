import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { classesApi, roomsApi, ClassItem, Room } from './classes.api';
import { studentsApi } from '../students/students.api';
import { peopleApi } from '../people/people.api';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlSearch, useUrlState } from '../../shared/hooks/useUrlState';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, MoneyInput, moneyDigits, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage, fetchAllPages } from '../../shared/components/Pagination';
import { Teacher, ScheduleEntry, getDayNames, formatVND, formatScheduleText } from '../../shared/types';
import { useMyPermissions } from '../system/roles.api';
import { Icon } from '../../shared/components/icons';
import './Classes.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

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
  const [editing, setEditing] = useState<ClassItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  // UX-6: trang/tìm kiếm nằm trên URL -> Back từ chi tiết lớp quay lại đúng chỗ
  const [q, setQ] = useUrlState({ search: '', page: '1' });
  const page = Number(q.page) || 1;
  // B-2: chữ đang gõ ở state cục bộ, URL nhận giá trị đã debounce
  const [search, setSearchReset] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }));
  const toast = useToast();
  const perms = useMyPermissions();

  // Deep-link ghi danh: /app/classes?enrollStudent=<id> mở modal chọn lớp cho học viên này
  const [searchParams, setSearchParams] = useSearchParams();
  const enrollStudentRaw = searchParams.get('enrollStudent');
  const enrollStudentId =
    enrollStudentRaw && Number.isFinite(Number(enrollStudentRaw)) ? Number(enrollStudentRaw) : null;
  const closeEnrollStudent = () => {
    const p = new URLSearchParams(searchParams);
    p.delete('enrollStudent');
    setSearchParams(p, { replace: true });
  };

  const debouncedSearch = q.search;
  const filtering = search.trim() !== '';

  const {
    data,
    loading,
    error,
    reload: load,
  } = useLoad(() => classesApi.list(debouncedSearch, { page }), [debouncedSearch, page]);
  const classes = data?.data ?? [];
  const pagination = data?.pagination ?? null;
  useEffect(() => {
    if (error) toastApiError(toast, error, t('toast.loadError'));
  }, [error, toast, t]);
  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới

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
      load();
    } catch (err) {
      toastApiError(toast, err, t('states.saveError', { ns: 'common' }));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await classesApi.remove(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      load();
    } catch (err) {
      toastApiError(toast, err, t('states.deleteError', { ns: 'common' }));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('title')}
        desc={t('desc')}
        actions={
          perms.has('classes.create') && (
            <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              {t('add')}
            </button>
          )
        }
      />

      <div className="toolbar">
        <span className={`search-wrap${search ? ' has-clear' : ''}`}>
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            aria-label={t('searchPlaceholder')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearchReset(e.target.value)}
          />
          {search !== '' &&
            (loading || search !== debouncedSearch ? (
              <span className="search-clear" aria-hidden="true">
                <span className="spinner spinner-dark" />
              </span>
            ) : (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchReset('')}
                aria-label={t('clearSearch')}
              >
                <Icon name="x" size={14} />
              </button>
            ))}
        </span>
      </div>

      {loading && !data ? (
        <CardGridSkeleton />
      ) : error && !data ? (
        <LoadError onRetry={load} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon="book"
          title={t(filtering ? 'emptyFiltered.title' : 'empty.title')}
          desc={t(filtering ? 'emptyFiltered.desc' : 'empty.desc')}
          action={
            filtering ? (
              <button className="btn btn-secondary btn-inline" onClick={() => setSearchReset('')}>
                <Icon name="x" size={14} />
                {t('emptyFiltered.clear')}
              </button>
            ) : (
              perms.has('classes.create') && (
                <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={14} />
                  {t('add')}
                </button>
              )
            )
          }
        />
      ) : (
        <div className="card-grid" aria-busy={loading || undefined}>
          {classes.map((c) => {
            const pct =
              c.max_students > 0 ? Math.min(100, Math.round((c.student_count / c.max_students) * 100)) : 0;
            const isFull = c.max_students > 0 && c.student_count >= c.max_students;
            return (
              <div key={c.id} className="card class-card">
                <div className="card-head">
                  <h2>
                    <Link className="link" to={`/app/classes/${c.id}`}>
                      {c.name}
                    </Link>
                  </h2>
                  <span className={`badge badge-${c.status}`}>{t('classStatus.' + c.status)}</span>
                </div>
                <dl className="dl dl-compact">
                  <dt>{t('table.teacher')}</dt>
                  <dd>{c.teacher_name || t('form.teacherUnassigned')}</dd>
                  <dt>{t('table.schedule')}</dt>
                  <dd>{formatScheduleText(c.schedule || '') || <EmptyCell />}</dd>
                  <dt>{t('table.fee')}</dt>
                  <dd className="num">{formatVND(c.tuition_fee)}</dd>
                  <dt>{t('table.size')}</dt>
                  <dd>
                    <span className="capacity-label">
                      <span className="num">
                        {c.student_count}/{c.max_students}
                      </span>
                      {isFull && <span className="badge badge-danger">{t('classes.full')}</span>}
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
                  {perms.has('classes.update') && (
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      {t('actions.edit', { ns: 'common' })}
                    </button>
                  )}
                  {perms.has('classes.delete') && (
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(c)}>
                      {t('actions.delete', { ns: 'common' })}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pagination && (
        <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
      )}

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
      {enrollStudentId != null && (
        <EnrollStudentModal studentId={enrollStudentId} onClose={closeEnrollStudent} />
      )}
    </div>
  );
}

/** Modal ghi danh trực tiếp 1 học viên vào lớp (mở từ deep-link trang chi tiết học viên). */
function EnrollStudentModal({ studentId, onClose }: { studentId: number; onClose: () => void }) {
  const { t } = useTranslation(['classes', 'common']);
  const [name, setName] = useState('');
  const [options, setOptions] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([studentsApi.get(studentId), fetchAllPages((p) => classesApi.list('', p))])
      .then(([s, all]) => {
        setName(s.student.name);
        setOptions(all.filter((c) => c.status === 'active'));
      })
      .catch((err: unknown) => toastApiError(toast, err, t('states.loadError', { ns: 'common' })));
  }, [studentId, toast]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !classId) return;
    setBusy(true);
    try {
      await classesApi.enroll(Number(classId), studentId);
      toast(t('detail.enroll.added'), 'success');
      onClose();
    } catch (err) {
      toastApiError(toast, err, t('detail.enroll.addError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('enrollStudent.title')} onClose={onClose} dirty={classId !== ''}>
      <p className="confirm-text">{t('enrollStudent.forStudent', { name })}</p>
      <form onSubmit={submit}>
        <Field label={t('enrollStudent.selectClass')}>
          <select
            className="text-input"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            required
          >
            <option value="">{t('enrollStudent.selectClass')}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {options.length === 0 && <p className="muted">{t('enrollStudent.noClasses')}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !classId}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('enrollStudent.enrolling') : t('enrollStudent.enroll')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Ca học không hợp lệ: thiếu giờ hoặc giờ kết thúc không sau giờ bắt đầu (chuỗi HH:MM so sánh được). */
const slotInvalid = (s: ScheduleEntry) => !s.start || !s.end || s.end <= s.start;

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
    tuition_fee: initial ? moneyDigits(initial.tuition_fee) : '',
    max_students: initial ? String(initial.max_students) : '30',
    status: initial?.status || 'active',
  }));
  const [initialForm] = useState(form);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<
    'name' | 'start_date' | 'end_date' | 'tuition_fee' | 'max_students'
  >();

  useEffect(() => {
    Promise.all([
      // ADM-6: server chặn 100/trang -> tải đủ mọi trang để không mất giáo viên/phòng cũ
      fetchAllPages((p) => peopleApi.listTeachers(p)),
      fetchAllPages((p) => roomsApi.list(p)),
    ])
      .then(([t, r]) => {
        setTeachers(t);
        setRooms(r);
      })
      .catch((err: unknown) => toastApiError(toast, err, t('states.loadError', { ns: 'common' })));
  }, [toast]);

  const set = (k: keyof ClassForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'name' || k === 'start_date' || k === 'end_date' || k === 'tuition_fee' || k === 'max_students')
      clear(k);
  };

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
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t('form.errors.nameRequired');
    if (form.start_date && form.end_date && form.end_date < form.start_date)
      errs.end_date = t('form.errors.endBeforeStart');
    const fee = Number(form.tuition_fee);
    if (!form.tuition_fee || !Number.isFinite(fee) || fee < 0) errs.tuition_fee = t('form.errors.feeInvalid');
    const maxS = Number(form.max_students);
    if (form.max_students && (!Number.isInteger(maxS) || maxS < 1))
      errs.max_students = t('form.errors.maxStudentsInvalid');
    // ADM-14: ca học giờ kết thúc <= giờ bắt đầu (lỗi hiện inline ngay dưới dòng ca)
    if (!show(errs) || form.schedule.some(slotInvalid)) return;
    setBusy(true);
    try {
      await onSave(form, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? t('form.editTitle') : t('form.addTitle')}
      onClose={onClose}
      wide
      dirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('form.name')} span error={errors.name}>
            <input ref={refFor('name')} className="text-input" value={form.name} onChange={set('name')} />
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
          <Field label={t('form.startDate')} error={errors.start_date}>
            <input
              ref={refFor('start_date')}
              className="text-input"
              type="date"
              value={form.start_date}
              onChange={set('start_date')}
            />
          </Field>
          <Field label={t('form.endDate')} error={errors.end_date}>
            <input
              ref={refFor('end_date')}
              className="text-input"
              type="date"
              value={form.end_date}
              onChange={set('end_date')}
            />
          </Field>
          <Field label={t('form.tuitionFee')} error={errors.tuition_fee}>
            <MoneyInput
              ref={refFor('tuition_fee')}
              className="text-input"
              value={form.tuition_fee}
              onChange={(v) => {
                setForm((f) => ({ ...f, tuition_fee: v }));
                clear('tuition_fee');
              }}
            />
          </Field>
          <Field label={t('form.maxStudents')} error={errors.max_students}>
            <input
              ref={refFor('max_students')}
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
            <div key={i}>
              <div className="schedule-row">
                <select
                  aria-label={t('form.dayOfWeekAria')}
                  className="text-input"
                  value={s.day}
                  onChange={(e) => updateSlot(i, { day: Number(e.target.value) })}
                >
                  {Object.entries(getDayNames()).map(([d, name]) => (
                    <option key={d} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  className="text-input"
                  type="time"
                  aria-label={t('form.startTimeAria')}
                  aria-invalid={slotInvalid(s) || undefined}
                  value={s.start}
                  onChange={(e) => updateSlot(i, { start: e.target.value })}
                />
                <EmptyCell />
                <input
                  className="text-input"
                  type="time"
                  aria-label={t('form.endTimeAria')}
                  aria-invalid={slotInvalid(s) || undefined}
                  aria-describedby={slotInvalid(s) ? `slot-err-${i}` : undefined}
                  value={s.end}
                  onChange={(e) => updateSlot(i, { end: e.target.value })}
                />
                <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => removeSlot(i)}>
                  {t('actions.delete', { ns: 'common' })}
                </button>
              </div>
              {slotInvalid(s) && (
                <p className="field-error" id={`slot-err-${i}`} role="alert">
                  {t('form.errors.slotEndBeforeStart')}
                </p>
              )}
            </div>
          ))}
          {form.schedule.length === 0 && <p className="muted">{t('form.noSchedule')}</p>}
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
