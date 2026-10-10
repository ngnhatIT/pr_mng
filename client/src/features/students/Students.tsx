import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { studentsApi, type Student } from './students.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { useDebounce } from '../../shared/hooks/useDebounce';
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

  const debouncedSearch = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await studentsApi.list(debouncedSearch, status, { page });
      setStudents(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page, toast, t]);
  useEffect(() => {
    void load();
  }, [load, debouncedSearch]);

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

  const filtering = search.trim() !== '' || status !== '';

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

      <div className="toolbar students-toolbar">
        <span className={`search-wrap${search ? ' has-clear' : ''}`}>
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
          {search !== '' &&
            (loading || search !== debouncedSearch ? (
              <span className="search-clear" aria-hidden="true">
                <span className="spinner spinner-dark" />
              </span>
            ) : (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchReset('')}
                aria-label={t('clearSearch')}
              >
                <Icon name="x" size={14} />
              </button>
            ))}
        </span>
        <select
          aria-label={t('statusFilterLabel')}
          className="text-input"
          value={status}
          onChange={(e) => setStatusReset(e.target.value)}
        >
          <option value="">{t('allStatuses')}</option>
          <option value="studying">{t('status.studying')}</option>
          <option value="paused">{t('status.paused')}</option>
          <option value="quit">{t('status.quit')}</option>
        </select>
      </div>

      {loading && students.length === 0 ? (
        <TableSkeleton cols={5} />
      ) : students.length === 0 ? (
        <EmptyState
          icon="users"
          title={t(filtering ? 'emptyFiltered.title' : 'empty.title')}
          desc={t(filtering ? 'emptyFiltered.desc' : 'empty.desc')}
          action={
            filtering ? (
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => {
                  setSearchReset('');
                  setStatusReset('');
                }}
              >
                <Icon name="x" size={14} />
                {t('emptyFiltered.clear')}
              </button>
            ) : (
              <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
                <Icon name="plus" size={14} />
                {t('add')}
              </button>
            )
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('table.code')}</th>
                <th scope="col">{t('table.name')}</th>
                <th scope="col">{t('table.phone')}</th>
                <th scope="col">{t('table.status')}</th>
                <th scope="col" className="th-right">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        <Icon name="user" size={15} />
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
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('actions.edit', { ns: 'common' })}
                        aria-label={t('actions.edit', { ns: 'common' })}
                        onClick={() => setEditing(s)}
                      >
                        <Icon name="pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        title={t('actions.delete', { ns: 'common' })}
                        aria-label={t('actions.delete', { ns: 'common' })}
                        onClick={() => setDeleting(s)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && <Pagination pagination={pagination} onChange={(p) => setPage(p)} loading={loading} />}

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
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'name' | 'phone' | 'email'>();
  const set =
    (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      if (k === 'name' || k === 'phone' || k === 'email') clear(k);
    };

  const validate = () => {
    const errs: { name?: string; phone?: string; email?: string } = {};
    if (!form.name.trim()) errs.name = t('form.errors.nameRequired');
    if (form.phone.trim() && !/^\+?[0-9][0-9\s.-]{6,13}[0-9]$/.test(form.phone.trim()))
      errs.phone = t('form.errors.phoneInvalid');
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim()))
      errs.email = t('form.errors.emailInvalid');
    return show(errs);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!validate()) return;
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
          <Field label={t('form.name')} error={errors.name}>
            <input ref={refFor('name')} className="text-input" value={form.name} onChange={set('name')} />
          </Field>
          <Field label={t('form.phone')} error={errors.phone}>
            <input
              ref={refFor('phone')}
              className="text-input"
              value={form.phone}
              onChange={set('phone')}
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label={t('form.email')} error={errors.email}>
            <input
              ref={refFor('email')}
              className="text-input"
              value={form.email}
              onChange={set('email')}
              inputMode="email"
              autoComplete="email"
            />
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
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
