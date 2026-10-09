import { useCallback, useEffect, useState } from 'react';
import { peopleApi, TeacherForm } from './people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Teacher } from '../../shared/types';

export function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Teacher | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [accounting, setAccounting] = useState<Teacher | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await peopleApi.listTeachers({ page });
      setTeachers(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: TeacherForm, id?: number) => {
    try {
      if (id) await peopleApi.updateTeacher(id, form);
      else await peopleApi.createTeacher(form);
      toast('Đã lưu giáo viên', 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await peopleApi.deleteTeacher(deleting.id);
      toast('Đã xóa giáo viên', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Giáo viên"
        desc="Quản lý giáo viên và tạo tài khoản đăng nhập cho họ"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Thêm giáo viên
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={6} />
      ) : teachers.length === 0 ? (
        <EmptyState
          icon="cap"
          title="Chưa có giáo viên nào"
          desc="Thêm giáo viên và tạo tài khoản để họ chấm công, điểm danh và giao bài tập."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Thêm giáo viên
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Môn dạy</th>
                <th>Điện thoại</th>
                <th>Email</th>
                <th>Lớp đang dạy</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.subject || '—'}</td>
                  <td>{t.phone || '—'}</td>
                  <td>{t.email || '—'}</td>
                  <td>{t.class_count ?? 0}</td>
                  <td className="td-right">
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => setEditing(t)}>
                        Sửa
                      </button>
                      <button className="btn btn-sm" onClick={() => setAccounting(t)}>
                        Tạo tài khoản
                      </button>
                      <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(t)}>
                        Xóa
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
        <TeacherFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa giáo viên"
          message={`Bạn có chắc muốn xóa giáo viên "${deleting.name}"? Các lớp đang phân công sẽ chuyển thành "Chưa phân công".`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
      {accounting && <AccountModal teacher={accounting} onClose={() => setAccounting(null)} />}
    </div>
  );
}

function AccountModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await peopleApi.createAccount(teacher.id, username, password);
      toast(`Đã tạo tài khoản "${username}" cho giáo viên ${teacher.name}`, 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo tài khoản thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Tạo tài khoản đăng nhập — ${teacher.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Giáo viên sẽ dùng tài khoản này để đăng nhập vào cổng giáo viên (xem buổi dạy, điểm danh, chấm
          công...).
        </p>
        <div className="form-grid">
          <Field label="Tên đăng nhập *">
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Field>
          <Field label="Mật khẩu *">
            <input
              className="text-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang tạo...' : 'Tạo tài khoản'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TeacherFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Teacher | null;
  onClose: () => void;
  onSave: (form: TeacherForm, id?: number) => Promise<void>;
}) {
  const [form, setForm] = useState<TeacherForm>({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    subject: initial?.subject || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof TeacherForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
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
    <Modal title={initial ? 'Sửa giáo viên' : 'Thêm giáo viên'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Họ tên *" span>
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Môn dạy">
            <input className="text-input" value={form.subject} onChange={set('subject')} />
          </Field>
          <Field label="Điện thoại">
            <input className="text-input" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" span>
            <input className="text-input" type="email" value={form.email} onChange={set('email')} />
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
