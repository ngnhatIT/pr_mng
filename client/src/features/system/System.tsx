import { useCallback, useEffect, useState } from 'react';
import { systemApi } from './system.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { CenterItem, PLAN_LABEL, labelOf, formatDate } from '../../shared/types';

const CENTERS_PER_PAGE = 20;

export function System() {
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CenterItem | null>(null);
  const [page, setPage] = useState(1);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.listCenters();
      setCenters(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách trung tâm', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        title="Hệ thống — Quản lý trung tâm"
        desc="Tạo trung tâm mới và quản lý gói cước"
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Tạo trung tâm mới
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={7} />
      ) : centers.length === 0 ? (
        <EmptyState
          icon="building"
          title="Chưa có trung tâm nào"
          desc="Nhấn “+ Tạo trung tâm mới” để thêm trung tâm đầu tiên."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tên trung tâm</th>
                <th>Subdomain</th>
                <th>Điện thoại</th>
                <th>Gói</th>
                <th>Hạn gói</th>
                <th>HV / Lớp / TK</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {centers.slice((page - 1) * CENTERS_PER_PAGE, page * CENTERS_PER_PAGE).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.subdomain}</td>
                  <td>{c.phone || '—'}</td>
                  <td>
                    <span className={`badge badge-plan-${c.plan}`}>{labelOf(PLAN_LABEL, c.plan)}</span>
                  </td>
                  <td>{formatDate(c.plan_expires_at)}</td>
                  <td className="num">
                    {c.student_count ?? 0} / {c.class_count ?? 0} / {c.user_count ?? 0}
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      Sửa gói / hạn
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(() => {
        const totalPages = Math.max(1, Math.ceil(centers.length / CENTERS_PER_PAGE));
        const pagination: PaginationMeta = {
          page: Math.min(page, totalPages),
          limit: CENTERS_PER_PAGE,
          total: centers.length,
          totalPages,
        };
        return <Pagination pagination={pagination} onChange={(p) => setPage(p)} />;
      })()}

      {showCreate && (
        <CreateCenterModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {editing && (
        <EditPlanModal
          center={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateCenterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [plan, setPlan] = useState('standard');
  const [expires, setExpires] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await systemApi.createCenter({
        name,
        subdomain,
        phone: phone || null,
        address: address || null,
        plan,
        plan_expires_at: expires || null,
        admin_username: adminUsername,
        admin_password: adminPassword,
      });
      toast('Đã tạo trung tâm mới', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Tạo thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tạo trung tâm mới" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tên trung tâm *">
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Subdomain *">
            <input
              className="text-input mono"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              required
            />
          </Field>
          <Field label="Điện thoại">
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Địa chỉ" span>
            <input className="text-input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Gói">
            <select className="text-input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="basic">Cơ bản</option>
              <option value="standard">Tiêu chuẩn</option>
              <option value="premium">Cao cấp</option>
            </select>
          </Field>
          <Field label="Hạn gói">
            <input
              className="text-input"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
          <Field label="Tài khoản admin *">
            <input
              className="text-input"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              required
            />
          </Field>
          <Field label="Mật khẩu admin *">
            <input
              className="text-input"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang tạo...' : 'Tạo trung tâm'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditPlanModal({
  center,
  onClose,
  onDone,
}: {
  center: CenterItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState(center.plan);
  const [expires, setExpires] = useState(center.plan_expires_at?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await systemApi.updatePlan(center.id, {
        plan,
        plan_expires_at: expires || null,
      });
      toast('Đã cập nhật gói', 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Cập nhật thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sửa gói — ${center.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Gói">
            <select
              className="text-input"
              value={plan}
              onChange={(e) => setPlan(e.target.value as CenterItem['plan'])}
            >
              <option value="basic">Cơ bản</option>
              <option value="standard">Tiêu chuẩn</option>
              <option value="premium">Cao cấp</option>
            </select>
          </Field>
          <Field label="Hạn gói">
            <input
              className="text-input"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
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
