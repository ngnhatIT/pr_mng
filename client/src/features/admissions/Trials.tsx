import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { trialsApi } from './admissions.api';
import { classesApi, type ClassItem } from '../classes/classes.api';
import { fetchAllPages } from '../../shared/components/Pagination';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Icon } from '../../shared/components/icons';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { useMyPermissions } from '../system/roles.api';
import { TrialItem, formatDate } from '../../shared/types';
import './Admissions.css';
import { EmptyCell } from '../../shared/components/EmptyCell';

// ADM-5: khớp TRIAL_STATUS của server. 'converted' chỉ đạt được qua nút Chuyển đổi (không chọn tay).
const STATUSES = ['new', 'contacted', 'converted'] as const;
const EDITABLE_STATUSES = ['new', 'contacted'] as const;

export function Trials() {
  const { t } = useTranslation(['ops', 'common']);
  const [q, setQ] = useUrlState({ status: '', page: '1' });
  const { status } = q;
  const page = Number(q.page) || 1;
  const [converting, setConverting] = useState<TrialItem | null>(null);
  const toast = useToast();
  const canManage = useMyPermissions().has('trials.manage');
  const { data, loading, error, reload, setData } = useLoad(
    () => trialsApi.list(status, { page }),
    [status, page]
  );
  const trials = data?.data ?? [];
  const pagination = data?.pagination ?? null;

  useEffect(() => {
    if (!data) return;
    const p = clampPage(page, data.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [data]); // chỉ kéo trang khi có kết quả mới
  useEffect(() => {
    if (error) toastApiError(toast, error, t('trials.toast.loadFail'));
  }, [error, toast, t]);

  const statusLabel = (s: string) => t(`trials.status.${s}`);

  // UX-12: đổi trạng thái lạc quan (select không bật về giá trị cũ trong lúc chờ), lỗi thì trả lại.
  const patchStatus = (id: number, next: TrialItem['status']) =>
    setData((d) => d && { ...d, data: d.data.map((x) => (x.id === id ? { ...x, status: next } : x)) });
  const changeStatus = async (tr: TrialItem, next: TrialItem['status']) => {
    patchStatus(tr.id, next);
    try {
      await trialsApi.setStatus(tr.id, next);
      toast(t('trials.toast.statusUpdated'), 'success');
      reload();
    } catch (err) {
      patchStatus(tr.id, tr.status);
      toastApiError(toast, err, t('trials.toast.updateFail'));
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('trials.title')} desc={t('trials.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => setQ({ status: e.target.value, page: '1' })}
          aria-label={t('trials.filterLabel')}
        >
          <option value="">{t('trials.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        {pagination && (
          <span className="toolbar-summary">{t('trials.totalCount', { total: pagination.total })}</span>
        )}
      </div>

      {loading && !data ? (
        <TableSkeleton cols={7} />
      ) : error && !data ? (
        <LoadError onRetry={reload} />
      ) : trials.length === 0 ? (
        <EmptyState
          icon="play"
          title={t(status ? 'trials.emptyFiltered.title' : 'trials.empty.title')}
          desc={t(status ? 'trials.emptyFiltered.desc' : 'trials.empty.desc')}
          action={
            status ? (
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => setQ({ status: '', page: '1' })}
              >
                <Icon name="x" size={14} />
                {t('trials.emptyFiltered.clear')}
              </button>
            ) : (
              <Link className="btn btn-primary btn-inline" to="/app/leads">
                {t('trials.empty.action')}
              </Link>
            )
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table table-stack">
            <thead>
              <tr>
                <th scope="col">{t('trials.col.name')}</th>
                <th scope="col">{t('trials.col.phone')}</th>
                <th scope="col">{t('trials.col.desiredClass')}</th>
                <th scope="col">{t('trials.col.desiredDate')}</th>
                <th scope="col">{t('trials.col.referral')}</th>
                <th scope="col">{t('trials.col.status')}</th>
                <th scope="col" className="th-right">
                  {t('trials.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {trials.map((tr) => (
                <tr key={tr.id}>
                  <td>{tr.name}</td>
                  <td data-label={t('trials.col.phone')}>{tr.phone}</td>
                  <td data-label={t('trials.col.desiredClass')}>{tr.class_name || <EmptyCell />}</td>
                  <td data-label={t('trials.col.desiredDate')}>{formatDate(tr.desired_date)}</td>
                  <td data-label={t('trials.col.referral')} className="mono">
                    {tr.referral_code || <EmptyCell />}
                  </td>
                  <td data-label={t('trials.col.status')}>
                    <span className={`badge badge-${tr.status} trial-badge`}>{statusLabel(tr.status)}</span>
                  </td>
                  <td className="td-right">
                    <span className="trial-actions">
                      {/* ADM-5: đã chuyển đổi thì chỉ hiện badge, không cho đổi ngược trạng thái (tránh convert lần 2
                          tạo học viên trùng) */}
                      {tr.status === 'converted' ? (
                        <span className="badge badge-converted">{t('trials.status.converted')}</span>
                      ) : (
                        canManage && (
                          <>
                            <select
                              className="text-input input-sm trial-status-select"
                              value={tr.status}
                              onChange={(e) => void changeStatus(tr, e.target.value as TrialItem['status'])}
                              aria-label={t('trials.changeStatusAria', { name: tr.name })}
                              title={t('trials.quickStatus')}
                            >
                              {EDITABLE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {statusLabel(s)}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-sm btn-primary" onClick={() => setConverting(tr)}>
                              {t('trials.convert')}
                            </button>
                          </>
                        )
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <Pagination pagination={pagination} onChange={(p) => setQ({ page: String(p) })} loading={loading} />
      )}

      {converting && (
        <ConvertModal
          title={t('trials.convertTitle', { name: converting.name })}
          onClose={() => setConverting(null)}
          onConvert={async (classId) => {
            try {
              const r = await trialsApi.convert(converting.id, classId ?? null);
              toast(t('trials.toast.converted', { id: r.student_id }), 'success');
              setConverting(null);
              reload();
            } catch (err) {
              toastApiError(toast, err, t('trials.toast.convertFail'));
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
  const { t } = useTranslation(['ops', 'common']);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { errors, refFor, show, clear } = useFieldErrors<'classId'>();

  useEffect(() => {
    fetchAllPages((p) => classesApi.list('', p))
      .then((c) => setClasses(c.filter((x) => x.status === 'active')))
      .catch((err: unknown) => {
        toastApiError(toast, err, t('trials.convertForm.loadFail'));
        show({ classId: t('trials.convertForm.loadFail') });
      });
  }, [toast, show, t]);

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
    <Modal title={title} onClose={onClose} dirty={classId !== ''}>
      <form onSubmit={submit}>
        <Field label={t('trials.convertForm.classLabel')} error={errors.classId}>
          <select
            className="text-input"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              clear('classId');
            }}
            ref={refFor('classId')}
          >
            <option value="">{t('trials.convertForm.noEnroll')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('trials.convertForm.converting') : t('trials.convertForm.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
