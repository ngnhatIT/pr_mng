import { useCallback, useEffect, useState } from 'react';
import { peopleApi } from './people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { PayrollRow, formatVND } from '../../shared/types';
import './Payroll.css';

export function Payroll() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await peopleApi.payroll(month);
      setRows(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được bảng lương', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="page">
      <PageHeader
        title="Lương giáo viên"
        desc="Tính lương giáo viên theo số buổi đã dạy trong tháng"
        actions={
          <span className="payroll-total">
            <Icon name="banknote" size={16} />
            Tổng chi
            <strong className="debt-amount">{formatVND(total)}</strong>
          </span>
        }
      />

      <div className="toolbar">
        <Field label="Tháng">
          <input
            className="text-input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="banknote"
          title="Không có dữ liệu lương"
          desc="Chưa có dữ liệu lương cho tháng này."
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Giáo viên</th>
                <th>Số buổi</th>
                <th>Đơn giá / buổi</th>
                <th>Tổng lương</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacher_id}>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        {r.teacher_name.charAt(0).toUpperCase()}
                      </span>
                      {r.teacher_name}
                    </span>
                  </td>
                  <td className="num">{r.sessions}</td>
                  <td className="num">{formatVND(r.per_session)}</td>
                  <td className="num">
                    <strong>{formatVND(r.total)}</strong>
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-inline" onClick={() => setEditing(r)}>
                      <Icon name="pencil" size={13} />
                      Đơn giá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RateModal
          row={editing}
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

function RateModal({ row, onClose, onDone }: { row: PayrollRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(row.per_session));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await peopleApi.savePayRule(row.teacher_id, Number(amount));
      toast(`Đã cập nhật đơn giá cho ${row.teacher_name}`, 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Cập nhật thất bại', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Đơn giá dạy - ${row.teacher_name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Đơn giá mỗi buổi (đ)">
          <input
            className="text-input"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
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
