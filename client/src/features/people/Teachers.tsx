import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { peopleApi, TeacherForm } from './people.api';
import { useToast, toastApiError } from '../../shared/ui/toast';
import { useLoad } from '../../shared/hooks/useLoad';
import { useUrlState } from '../../shared/hooks/useUrlState';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Field, useFieldErrors } from '../../shared/components/Form';
import { isValidVNPhone } from '../../shared/validation';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState, LoadError } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, clampPage } from '../../shared/components/Pagination';
import { useMyPermissions } from '../system/roles.api';
import { Icon } from '../../shared/components/icons';
import { Teacher } from '../../shared/types';
import './Teachers.css';
import { EmptyCell } from '../../shared/components/EmptyCell';
import { ResetRequestsSection } from './ResetRequests';

export function Teachers() {
  const { t } = useTranslation(['people', 'common']);
  const [editing, setEditing] = useState<Teacher | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [accounting, setAccounting] = useState<Teacher | null>(null);
  // UX-6: trang hiện tại nằm trên URL -> Back từ trang chi tiết giáo viên quay lại đúng trang
  const [q, setQ] = useUrlState({ page: '1' });
  const page = Number(q.page) || 1;
  const toast = useToast();
  const perms = useMyPermissions();

  const { data: res, loading, error, reload: load } = useLoad(() => peopleApi.listTeachers({ page }), [page]);
  const teachers: Teacher[] = res?.data ?? [];
  useEffect(() => {
    if (error) toastApiError(toast, error, t('toast.loadError'));
  }, [error, toast]);
  useEffect(() => {
    if (!res) return;
    const p = clampPage(page, res.pagination.totalPages);
    if (p !== page) setQ({ page: String(p) });
  }, [res, page, setQ]);

  const save = async (form: TeacherForm, id?: number) => {
    try {
      if (id) await peopleApi.updateTeacher(id, form);
      else await peopleApi.createTeacher(form);
      toast(t('toast.saved'), 'success');
      setEditing(null);
      load();
    } catch (err) {
      toastApiError(toast, err, t('states.saveError', { ns: 'common' }));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await peopleApi.deleteTeacher(deleting.id);
      toast(t('toast.deleted'), 'success');
      setDeleting(null);
      load();
    } catch (err) {
      toastApiError(toast, err, t('states.deleteError', { ns: 'common' }));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('teachers.title')}
        desc={t('desc')}
        actions={
          perms.has('teachers.create') && (
            <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} />
              {t('add')}
            </button>
          )
        }
      />

      {loading && !res ? (
        <TableSkeleton cols={6} />
      ) : error && !res ? (
        <LoadError onRetry={load} />
      ) : teachers.length === 0 ? (
        <EmptyState
          icon="cap"
          title={t('empty.title')}
          desc={t('empty.desc')}
          action={
            perms.has('teachers.create') && (
              <button className="btn btn-primary btn-inline" onClick={() => setEditing('new')}>
                <Icon name="plus" size={14} />
                {t('add')}
              </button>
            )
          }
        />
      ) : (
        <div className="table-wrap sticky" aria-busy={loading || undefined}>
          <table className="table table-stack">
            <thead>
              <tr>
                <th scope="col">{t('table.name')}</th>
                <th scope="col">{t('table.subject')}</th>
                <th scope="col">{t('table.phone')}</th>
                <th scope="col">{t('table.email')}</th>
                <th scope="col">{t('table.classes')}</th>
                <th scope="col" className="th-right">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((tch) => (
                <tr key={tch.id}>
                  <td>
                    <span className="name-cell">
                      <span className="avatar avatar-sm" aria-hidden="true">
                        <Icon name="user" size={15} />
                      </span>
                      <Link className="link" to={`/app/teachers/${tch.id}`}>
                        {tch.name}
                      </Link>
                    </span>
                  </td>
                  <td data-label={t('table.subject')}>{tch.subject || <EmptyCell />}</td>
                  <td data-label={t('table.phone')}>{tch.phone || <EmptyCell />}</td>
                  <td data-label={t('table.email')}>{tch.email || <EmptyCell />}</td>
                  <td data-label={t('table.classes')} className="num">
                    {tch.class_count ?? 0}
                  </td>
                  <td className="td-right">
                    <span className="row-actions">
                      {perms.has('teachers.update') && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEditing(tch)}
                        >
                          <Icon name="pencil" size={15} />
                          {t('actions.edit', { ns: 'common' })}
                        </button>
                      )}
                      {perms.has('users.create') && (
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('teachers.createAccount')}
                          aria-label={t('teachers.createAccount')}
                          onClick={() => setAccounting(tch)}
                        >
                          <Icon name="key" size={15} />
                        </button>
                      )}
                      {perms.has('teachers.delete') && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-ghost"
                          onClick={() => setDeleting(tch)}
                        >
                          <Icon name="trash" size={15} />
                          {t('actions.delete', { ns: 'common' })}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {res && (
        <Pagination
          pagination={res.pagination}
          onChange={(p) => setQ({ page: String(p) })}
          loading={loading}
        />
      )}

      <ResetRequestsSection />

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
      toastApiError(toast, err, t('account.createError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('account.title', { name: teacher.name })}
      onClose={onClose}
      dirty={!!(username || password)}
    >
      {/* ADM-17: chặn trình duyệt tự điền tài khoản đăng nhập của chính admin vào form tạo tài khoản */}
      <form onSubmit={submit} autoComplete="off">
        <p className="muted">{t('account.desc')}</p>
        <div className="form-grid">
          <Field label={t('account.username')}>
            <input
              className="text-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label={t('account.password')}>
            <input
              className="text-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
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
  const [initialForm] = useState(form);
  const [busy, setBusy] = useState(false);
  // Lỗi inline dưới field + focus field lỗi đầu tiên (skill 8.2); dữ liệu giữ nguyên khi lỗi
  const { errors, refFor, show, clear } = useFieldErrors<'name' | 'phone' | 'email'>();
  const set = (k: keyof TeacherForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'name' || k === 'phone' || k === 'email') clear(k);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs: { name?: string; phone?: string; email?: string } = {};
    if (!form.name.trim()) errs.name = t('form.errors.nameRequired');
    if (form.phone.trim() && !isValidVNPhone(form.phone)) errs.phone = t('form.errors.phoneInvalid');
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim()))
      errs.email = t('form.errors.emailInvalid');
    if (!show(errs)) return;
    setBusy(true);
    try {
      await onSave(form, initial?.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? t('form.editTitle') : t('form.addTitle')}
      onClose={onClose}
      dirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('form.name')} span error={errors.name}>
            <input ref={refFor('name')} className="text-input" value={form.name} onChange={set('name')} />
          </Field>
          <Field label={t('form.subject')}>
            <input className="text-input" value={form.subject} onChange={set('subject')} />
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
          <Field label={t('form.email')} span error={errors.email}>
            <input
              ref={refFor('email')}
              className="text-input"
              type="email"
              value={form.email}
              onChange={set('email')}
              autoComplete="email"
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
