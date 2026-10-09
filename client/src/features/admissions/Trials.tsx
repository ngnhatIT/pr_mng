import { useCallback, useEffect, useState } from 'react';
import { trialsApi } from './admissions.api';
import { ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { TrialItem, TRIAL_STATUS_LABEL, labelOf, formatDate } from '../../shared/types';

const STATUSES = ['new', 'contacted', 'trialed', 'enrolled', 'lost'] as const;

export function Trials() {
  const [trials, setTrials] = useState<TrialItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<TrialItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await trialsApi.list(status, { page });
      setTrials(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được danh sách học thử', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (t: TrialItem, next: string) => {
    try {
      await trialsApi.setStatus(t.id, next);
      toast('Đã cập nhật trạng thái', 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Cập nhật thất bại', 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Học thử" desc="Đăng ký học thử từ landing page — duyệt và chuyển thành học viên" />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelOf(TRIAL_STATUS_LABEL, s)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <TableSkeleton cols={7} />
      ) : trials.length === 0 ? (
        <EmptyState
          icon="play"
          title="Không có đăng ký học thử nào"
          desc="Khi phụ huynh đăng ký học thử trên landing page, thông tin sẽ hiện ở đây."
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Điện thoại</th>
                <th>Lớp mong muốn</th>
                <th>Ngày mong muốn</th>
                <th>Mã giới thiệu</th>
                <th>Trạng thái</th>
                <th className="th-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.phone}</td>
                  <td>{t.class_name || '—'}</td>
                  <td>{formatDate(t.desired_date)}</td>
                  <td className="mono">{t.referral_code || '—'}</td>
                  <td>
                    <select
                      className="text-input input-sm"
                      value={t.status}
                      onChange={(e) => void changeStatus(t, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {labelOf(TRIAL_STATUS_LABEL, s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-primary" onClick={() => setConverting(t)}>
                      Chuyển thành học viên
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {converting && (
        <ConvertModal
          title={`Chuyển "${converting.name}" thành học viên`}
          onClose={() => setConverting(null)}
          onConvert={async (classId) => {
            try {
              const r = await trialsApi.convert(converting.id, classId ?? null);
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

export function ConvertModal({
  title,
  onClose,
  onConvert,
}: {
  title: string;
  onClose: () => void;
  onConvert: (classId: number | null) => Promise<void>;
}) {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    trialsApi
      .listClasses()
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: Error) => toast(err.message, 'error'));
  }, [toast]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onConvert(classId ? Number(classId) : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Ghi danh vào lớp (tùy chọn)">
          <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">— Không ghi danh ngay —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang chuyển...' : 'Xác nhận'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
