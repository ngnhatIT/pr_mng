import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { classesApi, roomsApi, ClassItem, Room } from './classes.api';
import { peopleApi } from '../people/people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { CardGridSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Teacher, ScheduleEntry, DAY_NAMES, formatVND, formatScheduleText } from '../../shared/types';

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
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ClassItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await classesApi.list({ page });
      setClasses(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách lớp', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

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
      toast('Đã lưu lớp học', 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await classesApi.remove(deleting.id);
      toast('Đã xóa lớp học', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Lớp học"
        desc="Tạo lớp, xếp lịch, phân công giáo viên và ghi danh"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Thêm lớp học
          </button>
        }
      />

      {loading ? (
        <CardGridSkeleton />
      ) : classes.length === 0 ? (
        <EmptyState
          icon="book"
          title="Chưa có lớp học nào"
          desc="Tạo lớp học đầu tiên với lịch học, giáo viên và học phí."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Thêm lớp học
            </button>
          }
        />
      ) : (
        <div className="card-grid">
          {classes.map((c) => (
            <div key={c.id} className="card class-card card-hover">
              <div className="card-head">
                <h2>
                  <Link className="link" to={`/app/classes/${c.id}`}>
                    {c.name}
                  </Link>
                </h2>
                <span className={`badge badge-${c.status}`}>
                  {c.status === 'active' ? 'Đang mở' : 'Đã đóng'}
                </span>
              </div>
              <dl className="dl dl-compact">
                <dt>Giáo viên</dt>
                <dd>{c.teacher_name || 'Chưa phân công'}</dd>
                <dt>Lịch học</dt>
                <dd>{formatScheduleText(c.schedule || '') || '—'}</dd>
                <dt>Học phí</dt>
                <dd>{formatVND(c.tuition_fee)}</dd>
                <dt>Sĩ số</dt>
                <dd>
                  {c.student_count}/{c.max_students}
                </dd>
              </dl>
              <div className="card-foot">
                <Link className="btn btn-sm" to={`/app/classes/${c.id}`}>
                  Chi tiết
                </Link>
                <button className="btn btn-sm" onClick={() => setEditing(c)}>
                  Sửa
                </button>
                <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(c)}>
                  Xóa
                </button>
              </div>
            </div>
          ))}
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
          title="Xóa lớp học"
          message={`Bạn có chắc muốn xóa lớp "${deleting.name}"? Buổi học, điểm danh và ghi danh liên quan sẽ bị xóa theo.`}
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
    <Modal title={initial ? 'Sửa lớp học' : 'Thêm lớp học'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên lớp *" span>
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Giáo viên">
            <select className="text-input" value={form.teacher_id} onChange={set('teacher_id')}>
              <option value="">Chưa phân công</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trạng thái">
            <select className="text-input" value={form.status} onChange={set('status')}>
              <option value="active">Đang mở</option>
              <option value="inactive">Đã đóng</option>
            </select>
          </Field>
          <Field label="Phòng học">
            <select className="text-input" value={form.room_id} onChange={set('room_id')}>
              <option value="">Chưa gán phòng</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.capacity != null ? ` (${r.capacity} chỗ)` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ngày bắt đầu">
            <input className="text-input" type="date" value={form.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="Ngày kết thúc">
            <input className="text-input" type="date" value={form.end_date} onChange={set('end_date')} />
          </Field>
          <Field label="Học phí (đ) *">
            <input
              className="text-input"
              type="number"
              min={0}
              value={form.tuition_fee}
              onChange={set('tuition_fee')}
              required
            />
          </Field>
          <Field label="Sĩ số tối đa">
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
            <span className="field-label">Lịch học hàng tuần</span>
            <button type="button" className="btn btn-sm" onClick={addSlot}>
              + Thêm buổi
            </button>
          </div>
          {form.schedule.map((s, i) => (
            <div key={i} className="schedule-row">
              <select
                className="text-input"
                value={s.day}
                onChange={(e) => updateSlot(i, { day: Number(e.target.value) })}
              >
                {Object.entries(DAY_NAMES).map(([d, name]) => (
                  <option key={d} value={d}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                className="text-input"
                type="time"
                value={s.start}
                onChange={(e) => updateSlot(i, { start: e.target.value })}
              />
              <span className="muted">→</span>
              <input
                className="text-input"
                type="time"
                value={s.end}
                onChange={(e) => updateSlot(i, { end: e.target.value })}
              />
              <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => removeSlot(i)}>
                Xóa
              </button>
            </div>
          ))}
          {form.schedule.length === 0 && (
            <p className="muted">Chưa có lịch học. Buổi học sẽ không tự sinh.</p>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
