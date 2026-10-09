import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { leadsApi, LeadForm } from './admissions.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { LeadItem, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import { ConvertModal } from './Trials';
import './Admissions.css';

const COLUMNS = ['new', 'contacted', 'trial', 'enrolled', 'lost'] as const;

const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'trial',
  trial: 'enrolled',
};

export function Leads() {
  const { t } = useTranslation(['ops', 'common']);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeadItem | null | 'new'>(null);
  const [deleting, setDeleting] = useState<LeadItem | null>(null);
  const [converting, setConverting] = useState<LeadItem | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const statusLabel = (s: string) => t(`leads.status.${s}`);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadsApi.list({ page });
      setLeads(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leads.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: LeadForm, id?: number) => {
    try {
      if (id) await leadsApi.update(id, form);
      else await leadsApi.create(form);
      toast(t('leads.toast.saved'), 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leads.toast.saveFail'), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await leadsApi.remove(deleting.id);
      toast(t('leads.toast.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leads.toast.deleteFail'), 'error');
    }
  };

  const moveStatus = async (l: LeadItem, next: string) => {
    try {
      await leadsApi.setStatus(l.id, next);
      toast(t('leads.toast.moved', { name: l.name, label: statusLabel(next) }), 'success');
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('leads.toast.updateFail'), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('leads.title')}
        desc={t('leads.desc')}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} />
            {t('leads.add')}
          </button>
        }
      />

      {loading ? (
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
      ) : leads.length === 0 ? (
        <EmptyState
          icon="filter"
          title={t('leads.empty.title')}
          desc={t('leads.empty.desc')}
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} />
              {t('leads.add')}
            </button>
          }
        />
      ) : (
        <div className="lead-pipeline">
          <div className="pipeline" role="list" aria-label={t('leads.pipelineLabel')}>
            {COLUMNS.map((col) => {
              const items = leads.filter((l) => l.status === col);
              return (
                <div key={col} className="pipeline-col" role="listitem">
                  <div className="pipeline-head">
                    <span className={`badge badge-${col}`}>{statusLabel(col)}</span>
                    <span className="pipeline-count" title={t('leads.countTitle', { count: items.length })}>
                      {items.length}
                    </span>
                  </div>
                  {items.length === 0 && <p className="muted pipeline-empty">{t('leads.emptyCol')}</p>}
                  {items.map((l) => (
                    <div key={l.id} className="pipeline-card">
                      <div className="lead-name" title={l.name}>
                        {l.name}
                      </div>
                      <div className="lead-phone mono">{l.phone}</div>
                      {l.note && <p className="pipeline-note">{l.note}</p>}
                      <div className="muted">{formatDate(l.created_at)}</div>
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
                          className="btn btn-sm"
                          onClick={() => setEditing(l)}
                          title={t('leads.editTitle')}
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-danger-ghost"
                          onClick={() => setDeleting(l)}
                          title={t('leads.deleteTitle')}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                        {NEXT_STATUS[col] && (
                          <button
                            className="btn btn-sm btn-icon"
                            onClick={() => void moveStatus(l, NEXT_STATUS[col])}
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
                            title={t('leads.reopen')}
                            aria-label={t('leads.reopenAria', { name: l.name })}
                          >
                            <Icon name="rotate" size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
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
              void load();
            } catch (err) {
              toast(err instanceof Error ? err.message : t('leads.toast.convertFail'), 'error');
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
    <Modal title={initial ? t('leads.form.titleEdit') : t('leads.form.titleNew')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('leads.form.name')} span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('leads.form.phone')} span>
            <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
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
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
