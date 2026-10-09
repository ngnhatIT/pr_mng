import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { studentsApi, type Student } from './students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import './Students.css';

const emptyForm = {
  code: '',
  name: '',
  phone: '',
  email: '',
  dob: '',
  address: '',
  status: 'studying',
  note: '',
};

export function Students() {
  const { t } = useTranslation(['students', 'common']);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const setSearchReset = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const setStatusReset = (v: string) => {
    setStatus(v);
    setPage(1);
  };
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Student | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await studentsApi.list(search, status, { page });
      setStudents(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [search, status, page, toast, t]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const save = async (form: typeof emptyForm, id?: number) => {
    try {
      if (id) await studentsApi.update(id, form);
      else await studentsApi.create(form);
      toast(t('toast.saved'), 'success');
      setEditing(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.saveError', { ns: 'common' }), 'error');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await studentsApi.remove(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('states.deleteError', { ns: 'common' }), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('title')}
        desc={t('desc')}
        actions={
          <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} />
            {t('add')}
          </button>
        }
      />

      <div className="toolbar">
        <span className="search-wrap">
          <span className="search-icon">
            <Icon name="search" size={15} />
          </span>
          <input
            className="text-input search-input"
            aria-label={t('searchPlaceholder')}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearchReset(e.target.value)}
          />
        </span>
        <select className="text-input" value={status} onChange={(e) => setStatusReset(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          <option value="studying">{t('status.studying')}</option>
          <option value="paused">{t('status.paused')}</option>
          <option value="quit">{t('status.quit')}</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : students.length === 0 ? (
        <EmptyState
          icon="users"
          title={t('empty.title')}
          desc={t('empty.desc')}
          action={
            <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              {t('add')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap sticky">
          <table className="table">
            <thead>
              <tr>
                <th>{t('table.code')}</th>
                <th>{t('table.name')}</th>
                <th>{t('table.phone')}</th>
                <th>{t('table.status')}</th>
                <th className="th-right">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <Link className="link" to={`/app/students/${s.id}`}>
                        {s.name}
                      </Link>
                    </span>
                  </td>
                  <td>{s.phone || '-'}</td>
                  <td>
                    <span className={`badge badge-${s.status}`}>{t(`status.${s.status}`)}</span>
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm btn-inline" onClick={() => setEditing(s)}>
                      <Icon name="pencil" size={13} />
                      {t('actions.edit', { ns: 'common' })}
                    </button>{' '}
                    <button className="btn btn-sm btn-inline btn-danger-ghost" onClick={() => setDeleting(s)}>
                      <Icon name="trash" size={13} />
                      {t('actions.delete', { ns: 'common' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} />}

      {editing && (
        <StudentForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.message', { name: deleting.name })}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
          danger
        />
      )}
    </div>
  );
}

function StudentForm({
  initial,
  onClose,
  onSave,
}: {
  initial: Student | null;
  onClose: () => void;
  onSave: (form: typeof emptyForm, id?: number) => Promise<void>;
}) {
  const { t } = useTranslation(['students', 'common']);
  const [form, setForm] = useState<typeof emptyForm>({
    code: initial?.code || '',
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    dob: initial?.dob || '',
    address: initial?.address || '',
    status: initial?.status || 'studying',
    note: initial?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const set =
    (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSave(form, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? t('form.editTitle') : t('form.addTitle')} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('form.code')}>
            <input className="text-input" value={form.code} onChange={set('code')} disabled={!!initial} />
          </Field>
          <Field label={t('form.name')}>
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label={t('form.phone')}>
            <input className="text-input" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label={t('form.email')}>
            <input className="text-input" value={form.email} onChange={set('email')} />
          </Field>
          <Field label={t('form.dob')}>
            <input className="text-input" type="date" value={form.dob} onChange={set('dob')} />
          </Field>
          <Field label={t('form.status')}>
            <select className="text-input" value={form.status} onChange={set('status')}>
              <option value="studying">{t('status.studying')}</option>
              <option value="paused">{t('status.paused')}</option>
              <option value="quit">{t('status.quit')}</option>
            </select>
          </Field>
          <Field label={t('form.address')} span>
            <input className="text-input" value={form.address} onChange={set('address')} />
          </Field>
          <Field label={t('form.note')} span>
            <textarea className="text-input" rows={2} value={form.note} onChange={set('note')} />
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
