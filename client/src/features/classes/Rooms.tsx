import { useCallback, useEffect, useState } from 'react';
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
      toast(err instanceof Error ? err.message : 'Không tải được danh sách phòng', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: { name: string; capacity: string }, id?: number) => {
    try {
      const payload = { name: form.name, capacity: form.capacity ? Number(form.capacity) : null };
      if (id) await roomsApi.update(id, payload);
      else await roomsApi.create(payload);
      toast('Đã lưu phòng học', 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await roomsApi.remove(deleting.id);
      toast('Đã xóa phòng học', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Phòng học"
        desc="Xếp phòng cho các lớp - hệ thống tự cảnh báo khi trùng lịch"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} />
            Thêm phòng
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={4} />
      ) : rooms.length === 0 ? (
        <EmptyState
          icon="building"
          title="Chưa có phòng học nào"
          desc="Thêm phòng học để xếp lịch cho các lớp."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              Thêm phòng
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Tên phòng</th>
                <th>Sức chứa</th>
                <th>Số lớp đang dùng</th>
                <th>Tình trạng</th>
                <th className="th-right">Thao tác</th>
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
                      <span className="badge badge-active">Đang dùng</span>
                    ) : (
                      <span className="badge badge-idle">Trống</span>
                    )}
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>
                      Sửa
                    </button>{' '}
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(r)}>
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
        <RoomFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa phòng học"
          message={`Xóa phòng "${deleting.name}"? Các lớp đang gán phòng này sẽ chuyển thành "Chưa gán phòng".`}
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
    <Modal title={initial ? 'Sửa phòng học' : 'Thêm phòng học'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên phòng *" span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Sức chứa" span>
            <input
              className="text-input"
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Để trống nếu không giới hạn"
            />
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
