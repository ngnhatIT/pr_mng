import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from './system.api';
import { useToast } from '../../shared/ui/toast';
import { Modal } from '../../shared/components/Modal';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { TableSkeleton } from '../../shared/components/Skeleton';
import { Pagination, type PaginationMeta } from '../../shared/components/Pagination';
import { CenterItem, formatDate } from '../../shared/types';
import { Icon } from '../../shared/components/icons';
import './SystemAdmin.css';

const CENTERS_PER_PAGE = 20;

export function System() {
  const { t } = useTranslation(['ops', 'common']);
  const [centers, setCenters] = useState<CenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CenterItem | null>(null);
  const [page, setPage] = useState(1);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.listCenters();
      setCenters(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('system.toast.loadFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        title={t('system.title')}
        desc={t('system.desc')}
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={15} />
            {t('system.create')}
          </button>
        }
      />

      {loading ? (
        <TableSkeleton cols={6} />
      ) : centers.length === 0 ? (
        <EmptyState icon="building" title={t('system.empty.title')} desc={t('system.empty.desc')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('system.col.center')}</th>
                <th scope="col">{t('system.col.phone')}</th>
                <th scope="col">{t('system.col.plan')}</th>
                <th scope="col">{t('system.col.planExpiry')}</th>
                <th scope="col">{t('system.col.counts')}</th>
                <th scope="col" className="th-right">
                  {t('system.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {centers.slice((page - 1) * CENTERS_PER_PAGE, page * CENTERS_PER_PAGE).map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="center-name">{c.name}</div>
                    <div className="center-sub mono">{c.subdomain}</div>
                  </td>
                  <td>{c.phone || '-'}</td>
                  <td>
                    <span className={`badge badge-plan-${c.plan}`}>{t(`system.plan.${c.plan}`)}</span>
                  </td>
                  <td className="plan-expiry">{formatDate(c.plan_expires_at)}</td>
                  <td className="num">
                    {c.student_count ?? 0} / {c.class_count ?? 0} / {c.user_count ?? 0}
                  </td>
                  <td className="td-right">
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      <Icon name="pencil" size={14} />
                      {t('system.editPlan')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(() => {
        const totalPages = Math.max(1, Math.ceil(centers.length / CENTERS_PER_PAGE));
        const pagination: PaginationMeta = {
          page: Math.min(page, totalPages),
          limit: CENTERS_PER_PAGE,
          total: centers.length,
          totalPages,
        };
        return <Pagination pagination={pagination} onChange={(p) => setPage(p)} />;
      })()}

      {showCreate && (
        <CreateCenterModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {editing && (
        <EditPlanModal
          center={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateCenterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [plan, setPlan] = useState('standard');
  const [expires, setExpires] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await systemApi.createCenter({
        name,
        subdomain,
        phone: phone || null,
        address: address || null,
        plan,
        plan_expires_at: expires || null,
        admin_username: adminUsername,
        admin_password: adminPassword,
      });
      toast(t('system.toast.created'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('system.toast.createFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const planOptions = ['basic', 'standard', 'premium'] as const;

  return (
    <Modal title={t('system.createForm.title')} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="center-form-section">
          <h3>{t('system.createForm.sectionInfo')}</h3>
          <div className="form-grid">
            <Field label={t('system.createForm.name')}>
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label={t('system.createForm.subdomain')}>
              <input
                className="text-input mono"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                required
              />
            </Field>
            <Field label={t('system.createForm.phone')}>
              <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t('system.createForm.address')} span>
              <input className="text-input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="center-form-section">
          <h3>{t('system.createForm.sectionPlan')}</h3>
          <div className="form-grid">
            <Field label={t('system.createForm.plan')}>
              <select className="text-input" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {planOptions.map((p) => (
                  <option key={p} value={p}>
                    {t(`system.plan.${p}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('system.createForm.expires')}>
              <input
                className="text-input"
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="center-form-section">
          <h3>{t('system.createForm.sectionAdmin')}</h3>
          <div className="form-grid">
            <Field label={t('system.createForm.adminUsername')}>
              <input
                className="text-input"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                required
              />
            </Field>
            <Field label={t('system.createForm.adminPassword')}>
              <input
                className="text-input"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
              />
            </Field>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('system.createForm.creating') : t('system.createForm.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditPlanModal({
  center,
  onClose,
  onDone,
}: {
  center: CenterItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const [plan, setPlan] = useState(center.plan);
  const [expires, setExpires] = useState(center.plan_expires_at?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await systemApi.updatePlan(center.id, {
        plan,
        plan_expires_at: expires || null,
      });
      toast(t('system.toast.planUpdated'), 'success');
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('system.toast.updateFail'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const planOptions = ['basic', 'standard', 'premium'] as const;

  return (
    <Modal title={t('system.editPlanTitle', { name: center.name })} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={t('system.createForm.plan')}>
            <select
              className="text-input"
              value={plan}
              onChange={(e) => setPlan(e.target.value as CenterItem['plan'])}
            >
              {planOptions.map((p) => (
                <option key={p} value={p}>
                  {t(`system.plan.${p}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('system.createForm.expires')}>
            <input
              className="text-input"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
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
