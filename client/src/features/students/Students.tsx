import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { studentsApi, type Student } from './students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { STUDENT_STATUS_LABEL } from '../../shared/types';

const emptyForm = {
  code: '',
  name: '',
  phone: '',
  email: '',
  dob: '',
  address: '',
  status: 'studying',
  note: '',
};

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const setSearchReset = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const setStatusReset = (v: string) => {
    setStatus(v);
    setPage(1);
  };
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Student | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await studentsApi.list(search, status, { page });
      setStudents(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, status, page, toast]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const save = async (form: typeof emptyForm, id?: number) => {
    try {
      if (id) await studentsApi.update(id, form);
      else await studentsApi.create(form);
      toast('Đã lưu học viên', 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await studentsApi.remove(deleting.id);
      toast('Đã xóa học viên', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Học viên"
        desc="Quản lý hồ sơ và trạng thái học viên"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Thêm học viên
          </button>
        }
      />

      <div className="toolbar">
        <input
          className="text-input search-input"
          placeholder="Tìm theo tên, mã, số điện thoại..."
          value={search}
          onChange={(e) => setSearchReset(e.target.value)}
        />
        <select className="text-input" value={status} onChange={(e) => setStatusReset(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="studying">Đang học</option>
          <option value="paused">Tạm nghỉ</option>
          <option value="quit">Đã nghỉ</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : students.length === 0 ? (
        <EmptyState
          icon="users"
          title="Chưa có học viên nào"
          desc="Thêm học viên đầu tiên để bắt đầu quản lý danh sách."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Thêm học viên
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Họ tên</th>
                <th>Điện thoại</th>
                <th>Trạng thái</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td>
                    <Link className="link" to={`/app/students/${s.id}`}>
                      {s.name}
                    </Link>
                  </td>
                  <td>{s.phone || '—'}</td>
                  <td>
                    <span className={`badge badge-${s.status}`}>{STUDENT_STATUS_LABEL[s.status]}</span>
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm" onClick={() => setEditing(s)}>
                      Sửa
                    </button>{' '}
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(s)}>
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {editing && (
        <StudentForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa học viên"
          message={`Bạn có chắc muốn xóa học viên "${deleting.name}"? Toàn bộ dữ liệu liên quan (ghi danh, điểm danh, hóa đơn) cũng sẽ bị xóa.`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function StudentForm({
  initial,
  onClose,
  onSave,
}: {
  initial: Student | null;
  onClose: () => void;
  onSave: (form: typeof emptyForm, id?: number) => Promise<void>;
}) {
  const [form, setForm] = useState<typeof emptyForm>({
    code: initial?.code || '',
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    dob: initial?.dob || '',
    address: initial?.address || '',
    status: initial?.status || 'studying',
    note: initial?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const set =
    (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

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
    <Modal title={initial ? 'Sửa học viên' : 'Thêm học viên'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Mã học viên (để trống để tự sinh)">
            <input className="text-input" value={form.code} onChange={set('code')} disabled={!!initial} />
          </Field>
          <Field label="Họ tên *">
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Điện thoại">
            <input className="text-input" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input className="text-input" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Ngày sinh">
            <input className="text-input" type="date" value={form.dob} onChange={set('dob')} />
          </Field>
          <Field label="Trạng thái">
            <select className="text-input" value={form.status} onChange={set('status')}>
              <option value="studying">Đang học</option>
              <option value="paused">Tạm nghỉ</option>
              <option value="quit">Đã nghỉ</option>
            </select>
          </Field>
          <Field label="Địa chỉ" span>
            <input className="text-input" value={form.address} onChange={set('address')} />
          </Field>
          <Field label="Ghi chú" span>
            <textarea className="text-input" rows={2} value={form.note} onChange={set('note')} />
          </Field>
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
