import { useCallback, useEffect, useState } from 'react';
import { leadsApi, LeadForm } from './admissions.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { LeadItem, LEAD_STATUS_LABEL, labelOf, formatDate } from '../../shared/types';
import { ConvertModal } from './Trials';

const COLUMNS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;

const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'trial',
  trial: 'enrolled',
};

export function Leads() {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeadItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<LeadItem | null>(null);
  const [converting, setConverting] = useState<LeadItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadsApi.list({ page });
      setLeads(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: LeadForm, id?: number) => {
    try {
      if (id) await leadsApi.update(id, form);
      else await leadsApi.create(form);
      toast('Đã lưu lead', 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await leadsApi.remove(deleting.id);
      toast('Đã xóa lead', 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Xóa thất bại', 'error');
    }
  };

  const moveStatus = async (l: LeadItem, next: string) => {
    try {
      await leadsApi.setStatus(l.id, next);
      toast(`Đã chuyển "${l.name}" → ${labelOf(LEAD_STATUS_LABEL, next)}`, 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Cập nhật thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Tuyển sinh (Lead)"
        desc="Theo dõi khách hàng tiềm năng từ lúc liên hệ đến khi đăng ký"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Thêm lead
          </button>
        }
      />

      {loading ? (
        <div className="pipeline" aria-hidden="true">
          {COLUMNS.map((col) => (
            <div key={col} className="pipeline-col">
              <Skeleton width="50%" height={16} />
              <div style={{ marginTop: 10 }}>
                <Skeleton height={90} />
              </div>
              <div style={{ marginTop: 8 }}>
                <Skeleton height={90} />
              </div>
            </div>
          ))}
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          icon="filter"
          title="Chưa có lead nào"
          desc="Lead từ form đăng ký trên landing page sẽ tự động chảy vào đây."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              + Thêm lead
            </button>
          }
        />
      ) : (
        <div className="pipeline">
          {COLUMNS.map((col) => {
            const items = leads.filter((l) => l.status === col);
            return (
              <div key={col} className="pipeline-col">
                <div className="pipeline-head">
                  <span className={`badge badge-${col}`}>{labelOf(LEAD_STATUS_LABEL, col)}</span>
                  <span className="muted">{items.length}</span>
                </div>
                {items.map((l) => (
                  <div key={l.id} className="pipeline-card">
                    <strong>{l.name}</strong>
                    <div className="muted mono">{l.phone}</div>
                    {l.note && <p className="pipeline-note">{l.note}</p>}
                    <div className="muted">{formatDate(l.created_at)}</div>
                    <div className="pipeline-actions">
                      {NEXT_STATUS[col] && (
                        <button className="btn btn-sm" onClick={() => void moveStatus(l, NEXT_STATUS[col])}>
                          →
                        </button>
                      )}
                      {col === 'lost' && (
                        <button className="btn btn-sm" onClick={() => void moveStatus(l, 'new')}>
                          ↺ Mở lại
                        </button>
                      )}
                      <button className="btn btn-sm btn-primary" onClick={() => setConverting(l)}>
                        Thành HV
                      </button>
                      <button className="btn btn-sm" onClick={() => setEditing(l)}>
                        Sửa
                      </button>
                      <button className="btn btn-sm btn-danger-ghost" onClick={() => setDeleting(l)}>
                        Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {editing && (
        <LeadFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa lead"
          message={`Xóa lead "${deleting.name}"?`}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
      {converting && (
        <ConvertModal
          title={`Chuyển lead "${converting.name}" thành học viên`}
          onClose={() => setConverting(null)}
          onConvert={async (classId) => {
            try {
              const r = await leadsApi.convert(converting.id, classId ?? null);
              toast(`Đã tạo học viên mới (ID ${r.student_id})`, 'success');
              setConverting(null);
              void load();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Chuyển đổi thất bại', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function LeadFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: LeadItem | null;
  onClose: () => void;
  onSave: (form: LeadForm, id?: number) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [note, setNote] = useState(initial?.note || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSave({ name, phone, note }, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Sửa lead' : 'Thêm lead'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Họ tên *" span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Số điện thoại *" span>
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          <Field label="Ghi chú" span>
            <textarea
              className="text-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
