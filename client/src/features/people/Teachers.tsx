import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { peopleApi, TeacherForm } from './people.api';
import { useToast } from '../../shared/ui/toast';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { Icon } from '../../shared/components/icons';
import { Teacher } from '../../shared/types';
import './Teachers.css';

export function Teachers() {
  const { t } = useTranslation(['people', 'common']);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Teacher | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [accounting, setAccounting] = useState<Teacher | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await peopleApi.listTeachers({ page });
      setTeachers(res.data);
      setPagination(res.pagination);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (form: TeacherForm, id?: number) => {
    try {
      if (id) await peopleApi.updateTeacher(id, form);
      else await peopleApi.createTeacher(form);
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
      await peopleApi.deleteTeacher(deleting.id);
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
        title={t('teachers.title')}
        desc={t('desc')}
        actions={
          <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} />
            {t('add')}
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={6} />
      ) : teachers.length === 0 ? (
        <EmptyState
          icon="cap"
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
                <th>{t('table.name')}</th>
                <th>{t('table.subject')}</th>
                <th>{t('table.phone')}</th>
                <th>{t('table.email')}</th>
                <th>{t('table.classes')}</th>
                <th className="th-right">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((tch) => (
                <tr key={tch.id}>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        {tch.name.charAt(0).toUpperCase()}
                      </span>
                      {tch.name}
                    </span>
                  </td>
                  <td>{tch.subject || '-'}</td>
                  <td>{tch.phone || '-'}</td>
                  <td>{tch.email || '-'}</td>
                  <td className="num">{tch.class_count ?? 0}</td>
                  <td className="td-right">
                    <span className="row-actions">
                      <button className="btn btn-sm btn-inline" onClick={() => setEditing(tch)}>
                        <Icon name="pencil" size={13} />
                        {t('actions.edit', { ns: 'common' })}
                      </button>
                      <button className="btn btn-sm btn-inline" onClick={() => setAccounting(tch)}>
                        <Icon name="key" size={13} />
                        {t('teachers.createAccount')}
                      </button>
                      <button
                        className="btn btn-sm btn-inline btn-danger-ghost"
                        onClick={() => setDeleting(tch)}
                      >
                        <Icon name="trash" size={13} />
                        {t('actions.delete', { ns: 'common' })}
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

      {editing && (
        <TeacherFormModal
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
      {accounting && <AccountModal teacher={accounting} onClose={() => setAccounting(null)} />}
    </div>
  );
}

function AccountModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const { t } = useTranslation(['people', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await peopleApi.createAccount(teacher.id, username, password);
      toast(t('account.created', { username, name: teacher.name }), 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('account.createError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('account.title', { name: teacher.name })} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">{t('account.desc')}</p>
        <div className="form-grid">
          <Field label={t('account.username')}>
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </Field>
          <Field label={t('account.password')}>
            <input
              className="text-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('account.creating') : t('account.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TeacherFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Teacher | null;
  onClose: () => void;
  onSave: (form: TeacherForm, id?: number) => Promise<void>;
}) {
  const { t } = useTranslation(['people', 'common']);
  const [form, setForm] = useState<TeacherForm>({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    subject: initial?.subject || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof TeacherForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
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
    <Modal title={initial ? t('form.editTitle') : t('form.addTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('form.name')} span>
            <input className="text-input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label={t('form.subject')}>
            <input className="text-input" value={form.subject} onChange={set('subject')} />
          </Field>
          <Field label={t('form.phone')}>
            <input className="text-input" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label={t('form.email')} span>
            <input className="text-input" type="email" value={form.email} onChange={set('email')} />
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
