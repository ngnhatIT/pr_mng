import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trialsApi } from './admissions.api';
import { ClassItem } from '../classes/classes.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { TrialItem, formatDate } from '../../shared/types';
import './Admissions.css';

const STATUSES = ['new', 'contacted', 'trialed', 'enrolled', 'lost'] as const;

export function Trials() {
  const { t } = useTranslation(['ops', 'common']);
  const [trials, setTrials] = useState<TrialItem[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<TrialItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const statusLabel = (s: string) => t(`trials.status.${s}`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await trialsApi.list(status, { page });
      setTrials(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('trials.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (tr: TrialItem, next: string) => {
    try {
      await trialsApi.setStatus(tr.id, next);
      toast(t('trials.toast.statusUpdated'), 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('trials.toast.updateFail'), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('trials.title')} desc={t('trials.desc')} />

      <div className="toolbar">
        <select
          className="text-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
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
          <span className="toolbar-summary">
            {t('trials.totalCount', { total: pagination.total })}
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton cols={7} />
      ) : trials.length === 0 ? (
        <EmptyState
          icon="play"
          title={t('trials.empty.title')}
          desc={t('trials.empty.desc')}
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>{t('trials.col.name')}</th>
                <th>{t('trials.col.phone')}</th>
                <th>{t('trials.col.desiredClass')}</th>
                <th>{t('trials.col.desiredDate')}</th>
                <th>{t('trials.col.referral')}</th>
                <th>{t('trials.col.status')}</th>
                <th className="th-right">{t('trials.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((tr) => (
                <tr key={tr.id}>
                  <td>{tr.name}</td>
                  <td>{tr.phone}</td>
                  <td>{tr.class_name || '-'}</td>
                  <td>{formatDate(tr.desired_date)}</td>
                  <td className="mono">{tr.referral_code || '-'}</td>
                  <td>
                    <span className={`badge badge-${tr.status} trial-badge`}>
                      {statusLabel(tr.status)}
                    </span>
                  </td>
                  <td className="td-right">
                    <span className="trial-actions">
                      <select
                        className="text-input input-sm trial-status-select"
                        value={tr.status}
                        onChange={(e) => void changeStatus(tr, e.target.value)}
                        aria-label={t('trials.changeStatusAria', { name: tr.name })}
                        title={t('trials.quickStatus')}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(s)}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-sm btn-primary" onClick={() => setConverting(tr)}>
                        {t('trials.convert')}
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

      {converting && (
        <ConvertModal
          title={t('trials.convertTitle', { name: converting.name })}
          onClose={() => setConverting(null)}
          onConvert={async (classId) => {
            try {
              const r = await trialsApi.convert(converting.id, classId ?? null);
              toast(t('trials.toast.converted', { id: r.student_id }), 'success');
              setConverting(null);
              void load();
            } catch (err) {
              toast(err instanceof Error ? err.message : t('trials.toast.convertFail'), 'error');
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
        <Field label={t('trials.convertForm.classLabel')}>
          <select className="text-input" value={classId} onChange={(e) => setClassId(e.target.value)}>
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
            {busy ? t('trials.convertForm.converting') : t('trials.convertForm.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
