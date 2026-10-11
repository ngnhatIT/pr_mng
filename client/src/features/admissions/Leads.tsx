import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { leadsApi, LeadForm } from './admissions.api';
import { toastApiError, useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { isValidVNPhone } from '../../shared/validation';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { useMyPermissions } from '../system/roles.api';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlSearch, useUrlState } from '../../shared/hooks/useUrlState';
import { LeadItem, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import { ConvertModal } from './Trials';
import './Admissions.css';

const COLUMNS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;

// 'trial' -> 'enrolled' không đi qua PUT (server chặn) mà mở ConvertModal để tạo học viên (ADM-10)
const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'trial',
  trial: 'enrolled',
};
// Mỗi cột tải tối đa 100 lead (server chặn limit 100); số đếm cột lấy từ tổng thật của server.
const COL_LIMIT = 100;
type ColData = Record<string, { items: LeadItem[]; total: number }>;

export function Leads() {
  const { t } = useTranslation(['ops', 'common']);
  const [editing, setEditing] = useState<LeadItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<LeadItem | null>(null);
  const [converting, setConverting] = useState<LeadItem | null>(null);
  const [q, setQ] = useUrlState({ search: '' });
  // B-2: chữ đang gõ ở state cục bộ, URL nhận giá trị đã debounce
  const [search, setSearch] = useUrlSearch(q.search, (v) => setQ({ search: v }));
  // UX-12: id lead đang đổi trạng thái -> khóa nút của thẻ đó, chống bấm 2 lần gửi 2 request
  const [movingId, setMovingId] = useState<number | null>(null);
  const toast = useToast();
  const canManage = useMyPermissions().has('leads.manage');

  const statusLabel = (s: string) => t(`leads.status.${s}`);
  const debouncedSearch = q.search;
  const filtering = search.trim() !== '';

  // ADM-10: tải theo từng cột trạng thái (thay vì 1 trang 20 lead chia vào 5 cột) để số đếm mỗi cột đúng
  const {
    data: cols,
    loading,
    error,
    reload,
  } = useLoad(async (): Promise<ColData> => {
    const res = await Promise.all(
      COLUMNS.map((st) => leadsApi.list({ limit: COL_LIMIT }, debouncedSearch, st))
    );
    // Tổng mỗi cột lấy từ `counts` server trả (fallback: pagination.total của chính cột đó)
    const counts = res[0].counts;
    return Object.fromEntries(
      COLUMNS.map((st, i) => [st, { items: res[i].data, total: counts?.[st] ?? res[i].pagination.total }])
    );
  }, [debouncedSearch]);
  const leadCount = COLUMNS.reduce((n, st) => n + (cols?.[st]?.total ?? 0), 0);
  useEffect(() => {
    if (error) toastApiError(toast, error, t('leads.toast.loadFail'));
  }, [error, toast, t]);

  const save = async (form: LeadForm, id?: number) => {
    try {
      if (id) await leadsApi.update(id, form);
      else await leadsApi.create(form);
      toast(t('leads.toast.saved'), 'success');
      setEditing(null);
      reload();
    } catch (err) {
      toastApiError(toast, err, t('leads.toast.saveFail'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await leadsApi.remove(deleting.id);
      toast(t('leads.toast.deleted'), 'success');
      setDeleting(null);
      reload();
    } catch (err) {
      toastApiError(toast, err, t('leads.toast.deleteFail'));
    }
  };

  const moveStatus = async (l: LeadItem, next: string) => {
    if (movingId !== null) return;
    setMovingId(l.id);
    try {
      await leadsApi.setStatus(l.id, next);
      toast(t('leads.toast.moved', { name: l.name, label: statusLabel(next) }), 'success');
      reload();
    } catch (err) {
      toastApiError(toast, err, t('leads.toast.updateFail'));
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('leads.title')}
        desc={t('leads.desc')}
        actions={
          canManage && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} />
              {t('leads.add')}
            </button>
          )
        }
      />

      <div className="toolbar leads-toolbar">
        <span className={`search-wrap${search ? ' has-clear' : ''}`}>
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            aria-label={t('leads.searchPlaceholder')}
            placeholder={t('leads.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search !== '' &&
            (loading || search !== debouncedSearch ? (
              <span className="search-clear" aria-hidden="true">
                <span className="spinner spinner-dark" />
              </span>
            ) : (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch('')}
                aria-label={t('leads.clearSearch')}
              >
                <Icon name="x" size={14} />
              </button>
            ))}
        </span>
      </div>

      {loading && !cols ? (
        <div className="pipeline" aria-hidden="true">
          {COLUMNS.map((col) => (
            <div key={col} className="pipeline-col">
              <Skeleton width="50%" height={16} />
              <div className="pipeline-skel">
                <Skeleton height={90} />
              </div>
              <div className="pipeline-skel pipeline-skel-2">
                <Skeleton height={90} />
              </div>
            </div>
          ))}
        </div>
      ) : error && !cols ? (
        <LoadError onRetry={reload} />
      ) : leadCount === 0 ? (
        <EmptyState
          icon="inbox"
          title={t(filtering ? 'leads.emptyFiltered.title' : 'leads.empty.title')}
          desc={t(filtering ? 'leads.emptyFiltered.desc' : 'leads.empty.desc')}
          action={
            filtering ? (
              <button className="btn btn-secondary btn-inline" onClick={() => setSearch('')}>
                <Icon name="x" size={14} />
                {t('leads.emptyFiltered.clear')}
              </button>
            ) : (
              canManage && (
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={15} />
                  {t('leads.add')}
                </button>
              )
            )
          }
        />
      ) : (
        <div className="lead-pipeline" aria-busy={loading || undefined}>
          <div className="pipeline" role="list" aria-label={t('leads.pipelineLabel')}>
            {COLUMNS.map((col) => {
              const items = cols?.[col]?.items ?? [];
              const total = cols?.[col]?.total ?? 0;
              return (
                <div key={col} className="pipeline-col" role="listitem">
                  <div className="pipeline-head">
                    <span className={`badge badge-${col}`}>{statusLabel(col)}</span>
                    <span className="pipeline-count" title={t('leads.countTitle', { count: total })}>
                      {total}
                    </span>
                  </div>
                  {items.length === 0 && <p className="muted pipeline-empty">{t('leads.emptyCol')}</p>}
                  {total > items.length && (
                    <p className="muted pipeline-empty">
                      {t('leads.colMore', { shown: items.length, total })}
                    </p>
                  )}
                  {items.map((l) => (
                    <div key={l.id} className="pipeline-card">
                      <div className="lead-name" title={l.name}>
                        {l.name}
                      </div>
                      <div className="lead-phone mono">{l.phone}</div>
                      {l.note && <p className="pipeline-note">{l.note}</p>}
                      <div className="muted">{formatDate(l.created_at)}</div>
                      {canManage && (
                        <div className="pipeline-actions">
                          {/* HIGH-3: ẩn nút convert khi lead đã thành học viên để tránh tạo trùng */}
                          {l.status !== 'enrolled' ? (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => setConverting(l)}
                              title={t('leads.convertTitle')}
                            >
                              {t('leads.convert')}
                            </button>
                          ) : (
                            <span className="badge badge-enrolled">{t('leads.status.enrolled')}</span>
                          )}
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setEditing(l)}
                            title={t('leads.editTitle')}
                          >
                            <Icon name="pencil" size={14} />
                            {t('actions.edit', { ns: 'common' })}
                          </button>
                          <button
                            className="btn btn-sm btn-danger-ghost"
                            onClick={() => setDeleting(l)}
                            title={t('leads.deleteTitle')}
                          >
                            <Icon name="trash" size={14} />
                            {t('actions.delete', { ns: 'common' })}
                          </button>
                          {col !== 'lost' && col !== 'enrolled' && (
                            <button
                              className="btn btn-sm btn-icon"
                              onClick={() => void moveStatus(l, 'lost')}
                              disabled={movingId === l.id}
                              title={t('leads.markLost')}
                              aria-label={t('leads.markLostAria', { name: l.name })}
                            >
                              <Icon name="x" size={15} />
                            </button>
                          )}
                          {NEXT_STATUS[col] && (
                            <button
                              className="btn btn-sm btn-icon"
                              onClick={() =>
                                col === 'trial' ? setConverting(l) : void moveStatus(l, NEXT_STATUS[col])
                              }
                              disabled={movingId === l.id}
                              title={t('leads.moveNext', { label: statusLabel(NEXT_STATUS[col]) })}
                              aria-label={t('leads.moveNextAria', {
                                name: l.name,
                                label: statusLabel(NEXT_STATUS[col]),
                              })}
                            >
                              <Icon name="arrow-right" size={15} />
                            </button>
                          )}
                          {col === 'lost' && (
                            <button
                              className="btn btn-sm btn-icon"
                              onClick={() => void moveStatus(l, 'new')}
                              disabled={movingId === l.id}
                              title={t('leads.reopen')}
                              aria-label={t('leads.reopenAria', { name: l.name })}
                            >
                              <Icon name="rotate" size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <LeadFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('leads.delete.title')}
          message={t('leads.delete.message', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
      {converting && (
        <ConvertModal
          title={t('trials.convertTitle', { name: converting.name })}
          onClose={() => setConverting(null)}
          onConvert={async (classId) => {
            try {
              const r = await leadsApi.convert(converting.id, classId ?? null);
              toast(t('leads.toast.converted', { id: r.student_id }), 'success');
              setConverting(null);
              reload();
            } catch (err) {
              toastApiError(toast, err, t('leads.toast.convertFail'));
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
  const { t } = useTranslation(['ops', 'common']);
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [note, setNote] = useState(initial?.note || '');
  const [busy, setBusy] = useState(false);
  const { errors, refFor, show, clear } = useFieldErrors<'name' | 'phone'>();
  const dirty =
    name !== (initial?.name || '') || phone !== (initial?.phone || '') || note !== (initial?.note || '');

  const validate = () => {
    const errs: { name?: string; phone?: string } = {};
    if (!name.trim()) errs.name = t('leads.form.errors.nameRequired');
    if (!phone.trim()) errs.phone = t('leads.form.errors.phoneRequired');
    else if (!isValidVNPhone(phone)) errs.phone = t('leads.form.errors.phoneInvalid');
    return show(errs);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    try {
      await onSave({ name, phone, note }, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? t('leads.form.titleEdit') : t('leads.form.titleNew')}
      onClose={onClose}
      dirty={dirty}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('leads.form.name')} span error={errors.name}>
            <input
              className="text-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clear('name');
              }}
              ref={refFor('name')}
            />
          </Field>
          <Field label={t('leads.form.phone')} span error={errors.phone}>
            <input
              className="text-input"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clear('phone');
              }}
              ref={refFor('phone')}
              inputMode="tel"
            />
          </Field>
          <Field label={t('leads.form.note')} span>
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
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
