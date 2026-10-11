import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { zaloApi } from './notifications.api';
import { loadMyPermissions } from '../system/roles.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton, Skeleton } from '../../shared/components/Skeleton';
import { Pagination } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { useUnsavedGuard } from '../../shared/hooks/useUnsavedGuard';
import { Icon } from '../../shared/components/icons';
import { ZaloConfig, type ReminderItem, formatVND, formatDate, formatDateTime } from '../../shared/types';
import './Zalo.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

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

// ADM-2/ADM-9: chỉ gửi các key form này sửa (whitelist), KHÔNG spread cả response GET — GET trả kèm
// zalo_refresh_token/zalo_app_secret dạng mask, gửi lại là ghi đè secret thật bằng chuỗi mask.
const EDITABLE_KEYS = [
  'zalo_oa_id',
  'zalo_template_overdue',
  'zalo_template_upcoming',
  'zalo_enabled',
  'center_name',
  'reminder_hour',
  'reminder_overdue_days',
  'reminder_upcoming_days',
] as const;

/** Payload lưu cấu hình: các key được sửa + access token CHỈ khi người dùng gõ giá trị mới (không rỗng). */
export function buildZaloPayload(config: ZaloConfig, tokenInput: string): Partial<ZaloConfig> {
  const payload: Partial<ZaloConfig> = {};
  for (const k of EDITABLE_KEYS) payload[k] = config[k];
  if (tokenInput.trim()) payload.zalo_access_token = tokenInput.trim();
  return payload;
}

export function ZaloReminders() {
  const { t } = useTranslation(['ops', 'common']);
  const toast = useToast();

  // HIGH-6: kiểm tra permission notifications.manage thay vì role cứng.
  // Superadmin được seed toàn bộ permission nên vẫn vào được.
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const isAdmin = canManage === true;

  // config.zalo_access_token chỉ giữ mask từ server (để hiện placeholder/trạng thái); token mới gõ nằm ở tokenInput
  const [config, setConfig] = useState<ZaloConfig>(EMPTY_CONFIG);
  // Bản đã lưu trên server: so với form để biết còn thay đổi chưa lưu (chặn rời trang)
  const [savedConfig, setSavedConfig] = useState<ZaloConfig>(EMPTY_CONFIG);
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [viewing, setViewing] = useState<ReminderItem | null>(null);
  const [q, setQ] = useUrlState({ page: '1' });
  const HISTORY_LIMIT = 20;
  useUnsavedGuard(tokenInput.trim() !== '' || JSON.stringify(config) !== JSON.stringify(savedConfig));

  const loadConfig = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const data = { ...EMPTY_CONFIG, ...(await zaloApi.getConfig()) };
      setConfig(data);
      setSavedConfig(data);
    } catch (err) {
      toastApiError(toast, err, t('zalo.toast.loadConfigFail'));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast, t]);

  useEffect(() => {
    let alive = true;
    // UX-9: dùng cache quyền chung với Layout (không gọi /roles/me/permissions lần nữa)
    loadMyPermissions().then(
      (codes) => alive && setCanManage(codes.has('notifications.manage')),
      // fail-closed: không kiểm tra được permission thì không hiện form cấu hình
      () => alive && setCanManage(false)
    );
    return () => {
      alive = false;
    };
  }, []);

  const {
    data: reminders,
    loading: loadingHistory,
    error: historyError,
    reload: loadHistory,
  } = useLoad(() => zaloApi.history(100), []);
  const historyPages = Math.max(1, Math.ceil((reminders?.length ?? 0) / HISTORY_LIMIT));
  const historyPage = Math.min(Number(q.page) || 1, historyPages);
  useEffect(() => {
    if (historyError) toastApiError(toast, historyError, t('zalo.toast.loadHistoryFail'));
  }, [historyError, toast, t]);

  useEffect(() => {
    if (canManage === null) return;
    void loadConfig();
  }, [canManage, loadConfig]);

  const set = (k: keyof ZaloConfig) => (v: string) => setConfig((c) => ({ ...c, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const data = { ...EMPTY_CONFIG, ...(await zaloApi.saveConfig(buildZaloPayload(config, tokenInput))) };
      setConfig(data);
      setSavedConfig(data);
      setTokenInput('');
      toast(t('zalo.toast.savedConfig'), 'success');
    } catch (err) {
      toastApiError(toast, err, t('zalo.toast.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) {
      toast(t('zalo.toast.needPhone'), 'error');
      return;
    }
    setTesting(true);
    try {
      const r = await zaloApi.test(testPhone.trim());
      toast(r.message, r.status === 'failed' ? 'error' : 'success');
      loadHistory();
    } catch (err) {
      toastApiError(toast, err, t('zalo.toast.sendFail'));
    } finally {
      setTesting(false);
    }
  };

  const runOnce = async () => {
    setRunning(true);
    try {
      const r = await zaloApi.runOnce();
      toast(r.message, 'success');
      loadHistory();
    } catch (err) {
      toastApiError(toast, err, t('zalo.toast.runFail'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('zalo.title')} desc={t('zalo.desc')} />

      {isAdmin && !loading && (
        <div className="zalo-status">
          <span className="status-icon">
            <Icon name="zap" size={18} />
          </span>
          <div className="status-text">
            <div className="status-title">{t('zalo.status.title')}</div>
            <div className="status-desc">
              {config.zalo_access_token ? t('zalo.status.descConfigured') : t('zalo.status.descDemo')}
            </div>
          </div>
          {config.zalo_enabled === '1' ? (
            <span className="badge badge-approved">{t('zalo.status.on')}</span>
          ) : (
            <span className="badge badge-pending">{t('zalo.status.off')}</span>
          )}
        </div>
      )}

      {canManage === false && (
        <div className="card">
          <p className="confirm-text">{t('zalo.notAdmin')}</p>
        </div>
      )}

      {isAdmin && (
        <>
          <div className="card">
            <h2 className="card-title">{t('zalo.config.title')}</h2>
            <p className="card-desc">{t('zalo.config.desc')}</p>
            {loading ? (
              <div aria-hidden="true">
                <Skeleton height={38} radius={8} />
                <div className="zalo-skel-gap">
                  <Skeleton height={38} radius={8} />
                </div>
                <div className="zalo-skel-gap">
                  <Skeleton width="60%" height={38} radius={8} />
                </div>
              </div>
            ) : (
              <form onSubmit={save}>
                <div className="zalo-form-group">
                  <h3 className="zalo-group-title">{t('zalo.groups.oaInfo')}</h3>
                  <div className="form-grid">
                    <Field label={t('zalo.fields.centerName')}>
                      <input
                        className="text-input"
                        value={config.center_name}
                        onChange={(e) => set('center_name')(e.target.value)}
                        placeholder={t('zalo.ph.centerName')}
                      />
                    </Field>
                    <Field label={t('zalo.fields.oaId')} hint={t('zalo.fields.oaIdHint')}>
                      <input
                        className="text-input"
                        value={config.zalo_oa_id}
                        onChange={(e) => set('zalo_oa_id')(e.target.value)}
                        placeholder={t('zalo.ph.oaId')}
                      />
                    </Field>
                    <Field label={t('zalo.fields.accessToken')} hint={t('zalo.fields.accessTokenHint')} span>
                      <input
                        className="text-input"
                        type="password"
                        // Mask token đã lưu chỉ hiện ở placeholder; để trống = giữ nguyên token cũ
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={
                          config.zalo_access_token
                            ? t('zalo.ph.tokenSaved', { mask: config.zalo_access_token })
                            : t('zalo.ph.tokenNew')
                        }
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                </div>
                <div className="zalo-form-group">
                  <h3 className="zalo-group-title">{t('zalo.groups.templates')}</h3>
                  <div className="form-grid">
                    <Field
                      label={t('zalo.fields.templateOverdue')}
                      hint={t('zalo.fields.templateOverdueHint')}
                    >
                      <input
                        className="text-input"
                        value={config.zalo_template_overdue}
                        onChange={(e) => set('zalo_template_overdue')(e.target.value)}
                        placeholder={t('zalo.ph.templateOverdue')}
                      />
                    </Field>
                    <Field
                      label={t('zalo.fields.templateUpcoming')}
                      hint={t('zalo.fields.templateUpcomingHint')}
                    >
                      <input
                        className="text-input"
                        value={config.zalo_template_upcoming}
                        onChange={(e) => set('zalo_template_upcoming')(e.target.value)}
                        placeholder={t('zalo.ph.templateUpcoming')}
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
                  {t('zalo.enableDaily')}
                </label>
                <div className="modal-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving && <span className="spinner" aria-hidden="true" />}
                    {saving ? t('actions.saving', { ns: 'common' }) : t('zalo.saveConfig')}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">{t('zalo.schedule.title')}</h2>
            <p className="card-desc">{t('zalo.schedule.desc')}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(e);
              }}
            >
              <div className="form-grid">
                <Field label={t('zalo.fields.hour')}>
                  <input
                    className="text-input"
                    type="time"
                    value={config.reminder_hour}
                    onChange={(e) => set('reminder_hour')(e.target.value)}
                  />
                </Field>
                <Field label={t('zalo.fields.upcomingDays')}>
                  <input
                    className="text-input"
                    type="number"
                    min={0}
                    max={60}
                    value={config.reminder_upcoming_days}
                    onChange={(e) => set('reminder_upcoming_days')(e.target.value)}
                  />
                </Field>
                <Field label={t('zalo.fields.overdueDays')}>
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
                  {saving && <span className="spinner" aria-hidden="true" />}
                  {saving ? t('actions.saving', { ns: 'common' }) : t('zalo.saveSchedule')}
                </button>
                <button type="button" className="btn" onClick={runOnce} disabled={running}>
                  {running && <span className="spinner spinner-dark" aria-hidden="true" />}
                  <Icon name="play" size={15} />
                  {running ? t('zalo.running') : t('zalo.runNow')}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2 className="card-title">{t('zalo.test.title')}</h2>
            <p className="card-desc">{t('zalo.test.desc')}</p>
            <div className="inline-form">
              <Field label={t('zalo.test.phone')}>
                <input
                  className="text-input"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder={t('zalo.ph.testPhone')}
                />
              </Field>
              <button className="btn btn-primary" onClick={sendTest} disabled={testing}>
                {testing && <span className="spinner" aria-hidden="true" />}
                <Icon name="send" size={15} />
                {testing ? t('actions.sending', { ns: 'common' }) : t('zalo.test.send')}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="card zalo-history">
        <h2 className="card-title">{t('zalo.history.title')}</h2>
        <p className="card-desc">{t('zalo.history.desc')}</p>
        {loadingHistory && !reminders ? (
          <TableSkeleton cols={7} />
        ) : historyError && !reminders ? (
          <LoadError onRetry={loadHistory} />
        ) : !reminders || reminders.length === 0 ? (
          <EmptyState
            icon="bell"
            title={t('zalo.empty.title')}
            desc={t('zalo.empty.desc')}
            action={
              <button
                className="btn btn-primary btn-inline"
                onClick={() => void runOnce()}
                disabled={running}
              >
                {running && <span className="spinner" aria-hidden="true" />}
                <Icon name="play" size={15} />
                {running ? t('zalo.running') : t('zalo.runNow')}
              </button>
            }
          />
        ) : (
          <>
            <div className="table-wrap sticky" aria-busy={loadingHistory || undefined}>
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th scope="col">{t('zalo.col.time')}</th>
                    <th scope="col">{t('zalo.col.student')}</th>
                    <th scope="col">{t('zalo.col.phone')}</th>
                    <th scope="col">{t('zalo.col.amount')}</th>
                    <th scope="col">{t('zalo.col.kind')}</th>
                    <th scope="col">{t('zalo.col.status')}</th>
                    <th scope="col" className="th-right">
                      {t('zalo.col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reminders
                    .slice((historyPage - 1) * HISTORY_LIMIT, historyPage * HISTORY_LIMIT)
                    .map((r) => (
                      <tr key={r.id}>
                        <td data-label={t('zalo.col.time')} className="mono">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td>
                          {r.student_name || <EmptyCell />}
                          {r.student_code && <span className="muted mono"> ({r.student_code})</span>}
                        </td>
                        <td data-label={t('zalo.col.phone')} className="mono">
                          {r.phone || <EmptyCell />}
                        </td>
                        <td data-label={t('zalo.col.amount')} className="num">
                          {r.invoice_amount != null ? formatVND(r.invoice_amount) : '-'}
                        </td>
                        <td data-label={t('zalo.col.kind')}>
                          <span className={`badge badge-${r.kind}`}>
                            {t(`zalo.kind.${r.kind}`, { defaultValue: r.kind })}
                          </span>
                        </td>
                        <td data-label={t('zalo.col.status')}>
                          <span className={`badge badge-${r.status}`}>
                            {t(`zalo.reminderStatus.${r.status}`, { defaultValue: r.status })}
                          </span>
                        </td>
                        <td className="td-right">
                          <span className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title={t('zalo.viewContent')}
                              aria-label={t('zalo.viewContent')}
                              onClick={() => setViewing(r)}
                            >
                              <Icon name="eye" size={15} />
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Pagination
              pagination={{
                page: historyPage,
                limit: HISTORY_LIMIT,
                total: reminders.length,
                totalPages: historyPages,
              }}
              onChange={(p) => setQ({ page: String(p) })}
            />
          </>
        )}
      </div>

      {viewing && (
        <Modal title={t('zalo.view.title')} onClose={() => setViewing(null)}>
          <dl className="dl dl-compact">
            <dt>{t('zalo.col.student')}</dt>
            <dd>{viewing.student_name || <EmptyCell />}</dd>
            <dt>{t('zalo.col.phone')}</dt>
            <dd className="mono">{viewing.phone || <EmptyCell />}</dd>
            <dt>{t('zalo.col.kind')}</dt>
            <dd>{t(`zalo.kind.${viewing.kind}`, { defaultValue: viewing.kind })}</dd>
            <dt>{t('zalo.col.status')}</dt>
            <dd>{t(`zalo.reminderStatus.${viewing.status}`, { defaultValue: viewing.status })}</dd>
            <dt>{t('zalo.view.dueDate')}</dt>
            <dd>{formatDate(viewing.due_date)}</dd>
          </dl>
          <div className="message-preview">{viewing.message || t('zalo.view.noContent')}</div>
          {viewing.response && (
            <>
              <p className="card-desc zalo-response-label">{t('zalo.view.responseLabel')}</p>
              <div className="message-preview mono">{viewing.response}</div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => setViewing(null)}>
              {t('actions.close', { ns: 'common' })}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
