import { useCallback, useEffect, useState } from 'react';
import { getUser } from '../../shared/api/client';
import { zaloApi } from './notifications.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton, Skeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import {
  ZaloConfig,
  ReminderItem,
  REMINDER_KIND_LABEL,
  REMINDER_STATUS_LABEL,
  formatVND,
  formatDate,
} from '../../shared/types';
import './Zalo.css';

const EMPTY_CONFIG: ZaloConfig = {
  zalo_oa_id: '',
  zalo_access_token: '',
  zalo_template_overdue: '',
  zalo_template_upcoming: '',
  zalo_enabled: '0',
  center_name: '',
  reminder_hour: '08:00',
  reminder_overdue_days: '1',
  reminder_upcoming_days: '3',
};

export function ZaloReminders() {
  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const [config, setConfig] = useState<ZaloConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [viewing, setViewing] = useState<ReminderItem | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_LIMIT = 20;

  const loadConfig = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const data = await zaloApi.getConfig();
      setConfig({ ...EMPTY_CONFIG, ...data });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được cấu hình', 'error');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await zaloApi.history(100);
      setReminders(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được lịch sử', 'error');
    } finally {
      setLoadingHistory(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadConfig();
    void loadHistory();
  }, [loadConfig, loadHistory]);

  const set = (k: keyof ZaloConfig) => (v: string) => setConfig((c) => ({ ...c, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await zaloApi.saveConfig(config);
      setConfig({ ...EMPTY_CONFIG, ...data });
      toast('Đã lưu cấu hình Zalo', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lưu thất bại', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) {
      toast('Vui lòng nhập số điện thoại', 'error');
      return;
    }
    setTesting(true);
    try {
      const r = await zaloApi.test(testPhone.trim());
      toast(r.message, r.status === 'failed' ? 'error' : 'success');
      void loadHistory();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gửi thử thất bại', 'error');
    } finally {
      setTesting(false);
    }
  };

  const runOnce = async () => {
    setRunning(true);
    try {
      const r = await zaloApi.runOnce();
      toast(r.message, 'success');
      void loadHistory();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Chạy thất bại', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Nhắc học phí qua Zalo"
        desc="Gửi tin nhắn nhắc học phí tự động tới phụ huynh/học viên qua Zalo ZNS. Khi chưa cấu hình Access Token, hệ thống chạy ở chế độ demo - chỉ ghi log, không gửi tin thật."
      />

      {isAdmin && !loading && (
        <div className="zalo-status">
          <span className="status-icon">
            <Icon name="zap" size={18} />
          </span>
          <div className="status-text">
            <div className="status-title">Trạng thái nhắc tự động</div>
            <div className="status-desc">
              {config.zalo_access_token
                ? 'Đã cấu hình Access Token - tin nhắn gửi thật qua Zalo ZNS.'
                : 'Chưa có Access Token - hệ thống đang chạy chế độ demo, chỉ ghi log.'}
            </div>
          </div>
          {config.zalo_enabled === '1' ? (
            <span className="badge badge-approved">Đang bật</span>
          ) : (
            <span className="badge badge-pending">Đang tắt</span>
          )}
        </div>
      )}

      {!isAdmin && (
        <div className="card">
          <p className="confirm-text">
            Mục cấu hình chỉ dành cho Quản trị viên. Bạn vẫn có thể xem lịch sử nhắc bên dưới.
          </p>
        </div>
      )}

      {isAdmin && (
        <>
          <div className="card">
            <h2 className="card-title">Cấu hình Zalo OA</h2>
            <p className="card-desc">
              Lấy Access Token tại trang quản trị Zalo OA (mục Ứng dụng / API). Template ID lấy từ các mẫu tin
              ZNS đã được Zalo duyệt. Tên tham số mẫu ZNS cần đặt: ten_trung_tam, ten_hoc_vien, so_tien,
              han_nop, ma_hoa_don.
            </p>
            {loading ? (
              <div aria-hidden="true">
                <Skeleton height={38} radius={8} />
                <div style={{ marginTop: 12 }}>
                  <Skeleton height={38} radius={8} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Skeleton width="60%" height={38} radius={8} />
                </div>
              </div>
            ) : (
              <form onSubmit={save}>
                <div className="zalo-form-group">
                  <h3 className="zalo-group-title">Thông tin Zalo OA</h3>
                  <div className="form-grid">
                    <Field label="Tên trung tâm">
                      <input
                        className="text-input"
                        value={config.center_name}
                        onChange={(e) => set('center_name')(e.target.value)}
                        placeholder="Trung tâm Anh ngữ ABC"
                      />
                    </Field>
                    <Field label="OA ID">
                      <input
                        className="text-input"
                        value={config.zalo_oa_id}
                        onChange={(e) => set('zalo_oa_id')(e.target.value)}
                        placeholder="VD: 1234567890"
                      />
                    </Field>
                    <Field label="Access Token" span>
                      <input
                        className="text-input"
                        type="password"
                        value={config.zalo_access_token}
                        onChange={(e) => set('zalo_access_token')(e.target.value)}
                        placeholder={
                          config.zalo_access_token
                            ? '•••••••• (đã lưu - nhập mới để thay đổi)'
                            : 'Dán access token của OA'
                        }
                        autoComplete="off"
                      />
                    </Field>
                  </div>
                </div>
                <div className="zalo-form-group">
                  <h3 className="zalo-group-title">Mẫu tin ZNS</h3>
                  <div className="form-grid">
                    <Field label="Template ID - tin quá hạn">
                      <input
                        className="text-input"
                        value={config.zalo_template_overdue}
                        onChange={(e) => set('zalo_template_overdue')(e.target.value)}
                        placeholder="ID mẫu ZNS quá hạn"
                      />
                    </Field>
                    <Field label="Template ID - tin sắp đến hạn">
                      <input
                        className="text-input"
                        value={config.zalo_template_upcoming}
                        onChange={(e) => set('zalo_template_upcoming')(e.target.value)}
                        placeholder="ID mẫu ZNS sắp đến hạn"
                      />
                    </Field>
                  </div>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={config.zalo_enabled === '1'}
                    onChange={(e) => set('zalo_enabled')(e.target.checked ? '1' : '0')}
                  />
                  Bật nhắc học phí tự động mỗi ngày
                </label>
                <div className="modal-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">Lịch nhắc tự động</h2>
            <p className="card-desc">
              Hệ thống tự quét mỗi ngày vào giờ đã đặt. Chống spam: mỗi hóa đơn chỉ được nhắc 1 lần mỗi 3 ngày
              cho cùng một loại.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(e);
              }}
            >
              <div className="form-grid">
                <Field label="Giờ gửi mỗi ngày">
                  <input
                    className="text-input"
                    type="time"
                    value={config.reminder_hour}
                    onChange={(e) => set('reminder_hour')(e.target.value)}
                  />
                </Field>
                <Field label="Nhắc trước hạn (ngày)">
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={60}
                    value={config.reminder_upcoming_days}
                    onChange={(e) => set('reminder_upcoming_days')(e.target.value)}
                  />
                </Field>
                <Field label="Nhắc khi quá hạn sau (ngày)">
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={60}
                    value={config.reminder_overdue_days}
                    onChange={(e) => set('reminder_overdue_days')(e.target.value)}
                  />
                </Field>
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu lịch'}
                </button>
                <button type="button" className="btn" onClick={runOnce} disabled={running}>
                  <Icon name="play" size={15} />
                  {running ? 'Đang chạy...' : 'Chạy ngay một lần'}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2 className="card-title">Gửi tin nhắn thử</h2>
            <p className="card-desc">Gửi một tin nhắn mẫu tới số điện thoại bất kỳ để kiểm tra cấu hình.</p>
            <div className="inline-form">
              <Field label="Số điện thoại">
                <input
                  className="text-input"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="VD: 0912345678"
                />
              </Field>
              <button className="btn btn-primary" onClick={sendTest} disabled={testing}>
                <Icon name="send" size={15} />
                {testing ? 'Đang gửi...' : 'Gửi tin nhắn thử'}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="card zalo-history">
        <h2 className="card-title">Lịch sử nhắc</h2>
        <p className="card-desc">100 lần nhắc gần nhất.</p>
        {loadingHistory ? (
          <TableSkeleton cols={7} />
        ) : reminders.length === 0 ? (
          <EmptyState
            icon="bell"
            title="Chưa có lịch sử nhắc nào"
            desc="Các tin nhắn nhắc học phí sẽ được ghi lại tại đây."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Học viên</th>
                    <th>SĐT</th>
                    <th>Số tiền</th>
                    <th>Loại</th>
                    <th>Trạng thái</th>
                    <th className="th-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {reminders
                    .slice((historyPage - 1) * HISTORY_LIMIT, historyPage * HISTORY_LIMIT)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                        <td>
                          {r.student_name || '-'}
                          {r.student_code && <span className="muted mono"> ({r.student_code})</span>}
                        </td>
                        <td className="mono">{r.phone || '-'}</td>
                        <td className="num">
                          {r.invoice_amount != null ? formatVND(r.invoice_amount) : '-'}
                        </td>
                        <td>
                          <span className={`badge badge-${r.kind}`}>
                            {REMINDER_KIND_LABEL[r.kind] || r.kind}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge-${r.status}`}>
                            {REMINDER_STATUS_LABEL[r.status] || r.status}
                          </span>
                        </td>
                        <td className="td-right">
                          <button className="btn btn-sm" onClick={() => setViewing(r)}>
                            <Icon name="eye" size={14} />
                            Xem nội dung
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {(() => {
              const totalPages = Math.max(1, Math.ceil(reminders.length / HISTORY_LIMIT));
              const pagination: PaginationMeta = {
                page: Math.min(historyPage, totalPages),
                limit: HISTORY_LIMIT,
                total: reminders.length,
                totalPages,
              };
              return <Pagination pagination={pagination} onChange={(p) => setHistoryPage(p)} />;
            })()}
          </>
        )}
      </div>

      {viewing && (
        <Modal title="Nội dung tin nhắn" onClose={() => setViewing(null)}>
          <dl className="dl dl-compact">
            <dt>Học viên</dt>
            <dd>{viewing.student_name || '-'}</dd>
            <dt>SĐT</dt>
            <dd className="mono">{viewing.phone || '-'}</dd>
            <dt>Loại</dt>
            <dd>{REMINDER_KIND_LABEL[viewing.kind] || viewing.kind}</dd>
            <dt>Trạng thái</dt>
            <dd>{REMINDER_STATUS_LABEL[viewing.status] || viewing.status}</dd>
            <dt>Hạn nộp</dt>
            <dd>{formatDate(viewing.due_date)}</dd>
          </dl>
          <div className="message-preview">{viewing.message || '(không có nội dung)'}</div>
          {viewing.response && (
            <>
              <p className="card-desc" style={{ marginTop: 12 }}>
                Phản hồi từ Zalo API:
              </p>
              <div className="message-preview mono">{viewing.response}</div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setViewing(null)}>
              Đóng
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
