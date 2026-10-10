/**
 * Trang quản trị Phân quyền (RBAC).
 *
 * Design read: công cụ cho admin trung tâm - calm, rõ ràng, mật độ trung bình-cao.
 * Cột trái: danh sách vai trò (tìm kiếm + chọn). Cột phải: ma trận quyền nhóm theo
 * module, mỗi quyền chọn phạm vi qua segmented control. System role chỉ xem.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/icons';
import {
  rolesApi,
  moduleLabelKey,
  scopeLabelKey,
  type Role,
  type RoleDetail,
  type Permission,
  type Scope,
} from './roles.api';
import './Roles.css';

const SCOPES: (Scope | null)[] = [null, 'own', 'center', 'all'];

type Draft = Record<string, Scope | null>;

function draftFromDetail(detail: RoleDetail, catalog: Permission[]): Draft {
  const d: Draft = {};
  for (const p of catalog) d[p.code] = null;
  for (const p of detail.permissions) d[p.code] = p.scope;
  return d;
}

function RoleForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: { name: string; description: string };
  onClose: () => void;
  onSubmit: (input: { code?: string; name: string; description?: string }) => Promise<void>;
}) {
  const { t } = useTranslation(['roles', 'common']);
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast(t('form.needName'), 'error');
      return;
    }
    let clean: string | undefined;
    if (!initial) {
      clean =
        code
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_') ||
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_');
      if (!clean) {
        toast(t('form.needCode'), 'error');
        return;
      }
    }
    setSaving(true);
    try {
      await onSubmit({ code: clean, name: name.trim(), description: description.trim() || undefined });
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('form.saveFail'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-grid">
      {!initial && (
        <label className="form-field">
          <span>{t('form.code')}</span>
          <input
            className="text-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('form.codePh')}
          />
        </label>
      )}
      <label className="form-field">
        <span>{t('form.name')}</span>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('form.namePh')}
          autoFocus
        />
      </label>
      <label className="form-field">
        <span>{t('form.desc')}</span>
        <textarea
          className="text-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('form.descPh')}
          rows={3}
        />
      </label>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          {t('actions.cancel', { ns: 'common' })}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving && <span className="spinner" aria-hidden="true" />}
          {saving ? t('saving') : initial ? t('form.save') : t('form.create')}
        </button>
      </div>
    </div>
  );
}

export function Roles() {
  const { t } = useTranslation(['roles', 'common']);
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const SCOPE_SHORT: Record<string, string> = {
    '': t('scopeShort.off'),
    own: t('scopeShort.own'),
    center: t('scopeShort.center'),
    all: t('scopeShort.all'),
  };

  const loadRoles = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([rolesApi.list(), rolesApi.permissions()]);
      setRoles(r);
      setCatalog(c.rows);
      setSelectedId((prev) => {
        if (prev && r.some((x) => x.id === prev)) return prev;
        return r[0]?.id ?? null;
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      // Match theo error code, không match message (message đổi theo ngôn ngữ)
      if (e?.code === 'FORBIDDEN' || e?.code === 'PERMISSION_DENIED') setForbidden(true);
      else toast(e instanceof Error ? e.message : t('toast.loadRolesFail'), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const d = await rolesApi.detail(id);
        setDetail(d);
      } catch (err) {
        toast(err instanceof Error ? err.message : t('toast.loadDetailFail'), 'error');
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast, t]
  );

  useEffect(() => {
    if (selectedId !== null) {
      setDraft({});
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  // Khởi tạo draft khi có detail + catalog (chỉ cho custom role)
  useEffect(() => {
    if (detail && !detail.is_system && catalog.length > 0) {
      setDraft(draftFromDetail(detail, catalog));
    }
  }, [detail, catalog]);

  const dirty = useMemo(() => {
    if (!detail || detail.is_system) return false;
    const base = draftFromDetail(detail, catalog);
    return Object.keys(base).some((k) => base[k] !== draft[k]);
  }, [detail, draft, catalog]);

  const changedCount = useMemo(() => {
    if (!detail || detail.is_system) return 0;
    const base = draftFromDetail(detail, catalog);
    return Object.keys(base).filter((k) => base[k] !== draft[k]).length;
  }, [detail, draft, catalog]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of catalog) {
      const arr = map.get(p.module) ?? [];
      arr.push(p);
      map.set(p.module, arr);
    }
    return [...map.entries()];
  }, [catalog]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [roles, search]);

  const setScope = (code: string, scope: Scope | null) => {
    setDraft((d) => ({ ...d, [code]: scope }));
  };

  const toggleModule = (module: string, on: boolean) => {
    setDraft((d) => {
      const next = { ...d };
      for (const p of catalog) {
        if (p.module === module) next[p.code] = on ? 'center' : null;
      }
      return next;
    });
  };

  const savePermissions = async () => {
    if (!detail || detail.is_system) return;
    setSaving(true);
    try {
      const permissions = Object.entries(draft)
        .filter(([, s]) => s !== null)
        .map(([code, scope]) => ({ code, scope: scope as Scope }));
      await rolesApi.setPermissions(detail.id, permissions);
      toast(t('toast.savedPerms', { count: permissions.length }), 'success');
      await loadDetail(detail.id);
      await loadRoles();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.savePermsFail'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (detail) setDraft(draftFromDetail(detail, catalog));
  };

  const doDelete = async () => {
    if (!detail) return;
    try {
      await rolesApi.remove(detail.id);
      toast(t('toast.deleted'), 'success');
      setConfirmDelete(false);
      setSelectedId(null);
      setDetail(null);
      await loadRoles();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('toast.deleteFail'), 'error');
    }
  };

  const doUpdateRole = async (input: { name: string; description: string }) => {
    if (!detail) return;
    await rolesApi.update(detail.id, input);
    toast(t('toast.updated'), 'success');
    await loadRoles();
    await loadDetail(detail.id);
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader title={t('title')} desc={t('desc')} />
        <Skeleton height={420} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="page">
        <PageHeader title={t('title')} desc={t('desc')} />
        <EmptyState icon="lock" title={t('forbidden.title')} desc={t('forbidden.desc')} />
      </div>
    );
  }

  return (
    <div className="page roles-page">
      <PageHeader
        title={t('title')}
        desc={t('desc')}
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={16} />
            {t('create')}
          </button>
        }
      />

      <div className="roles-layout">
        {/* Cột trái: danh sách vai trò */}
        <aside className="roles-list-col">
          <span className={`search-wrap roles-search${search ? ' has-clear' : ''}`}>
            <Icon name="search" size={16} className="search-icon" />
            <input
              className="text-input roles-search-input"
              placeholder={t('searchPh')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search !== '' && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearch('')}
                aria-label={t('clear', { ns: 'common' })}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </span>
          <div className="roles-list">
            {filteredRoles.length === 0 ? (
              <EmptyState icon="users" title={t('emptySearch.title')} desc={t('emptySearch.desc')} />
            ) : (
              filteredRoles.map((r) => (
                <button
                  key={r.id}
                  className={`role-card${r.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <div className="role-card-top">
                    <span className="role-card-name">{r.name}</span>
                    {r.is_system ? (
                      <span className="badge badge-system">{t('badge.system')}</span>
                    ) : (
                      <span className="badge badge-custom">{t('badge.custom')}</span>
                    )}
                  </div>
                  <div className="role-card-meta">
                    <span className="mono">@{r.code}</span>
                    <span aria-label={t('card.permCount', { count: r.perm_count })}>
                      <Icon name="key" size={13} /> {r.perm_count}
                    </span>
                    <span aria-label={t('card.userCount', { count: r.user_count })}>
                      <Icon name="users" size={13} /> {r.user_count}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Cột phải: chi tiết + ma trận quyền */}
        <section className="roles-detail-col">
          {detailLoading ? (
            <Skeleton height={420} />
          ) : !detail ? (
            <EmptyState icon="key" title={t('selectRole.title')} desc={t('selectRole.desc')} />
          ) : (
            <>
              <div className="role-head">
                <div className="role-head-icon">
                  <Icon name={detail.is_system ? 'shield' : 'key'} size={22} />
                </div>
                <div className="role-head-info">
                  <h2>{detail.name}</h2>
                  <p>{detail.description || t('noDesc')}</p>
                  <div className="role-head-tags">
                    <span className="mono muted">@{detail.code}</span>
                    {detail.is_system && <span className="badge badge-system">{t('systemNote')}</span>}
                  </div>
                </div>
                {!detail.is_system && (
                  <div className="role-head-actions">
                    <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>
                      <Icon name="pencil" size={15} /> {t('edit')}
                    </button>
                  </div>
                )}
              </div>

              {detail.is_system ? (
                <div className="perm-groups">
                  {grouped.map(([module]) => {
                    const assigned = detail.permissions.filter((p) => p.module === module);
                    if (assigned.length === 0) return null;
                    return (
                      <div key={module} className="perm-group">
                        <div className="perm-group-head">
                          <span className="perm-group-name">
                            {t(moduleLabelKey(module), { defaultValue: module })}
                          </span>
                          <span className="muted">{t('modulePermCount', { count: assigned.length })}</span>
                        </div>
                        <ul className="perm-list">
                          {assigned.map((p) => (
                            <li key={p.code} className="perm-row readonly">
                              <div className="perm-info">
                                <div className="perm-name">{p.name}</div>
                                <div className="perm-code mono muted">{p.code}</div>
                              </div>
                              <span className={`scope-tag scope-${p.scope}`}>
                                {t(scopeLabelKey(p.scope))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div className="perm-groups">
                    {grouped.map(([module, perms]) => {
                      const onCount = perms.filter((p) => draft[p.code]).length;
                      const allOn = onCount === perms.length;
                      return (
                        <div key={module} className="perm-group">
                          <div className="perm-group-head">
                            <span className="perm-group-name">
                              {t(moduleLabelKey(module), { defaultValue: module })}
                            </span>
                            <span className="perm-group-tools">
                              <span className="muted">
                                {t('onCount', { on: onCount, total: perms.length })}
                              </span>
                              <button className="link-btn" onClick={() => toggleModule(module, !allOn)}>
                                {allOn ? t('turnOffAll') : t('turnOnAll')}
                              </button>
                            </span>
                          </div>
                          <ul className="perm-list">
                            {perms.map((p) => (
                              <li key={p.code} className={`perm-row${draft[p.code] ? ' on' : ''}`}>
                                <div className="perm-info">
                                  <div className="perm-name">{p.name}</div>
                                  {p.description && <div className="perm-desc">{p.description}</div>}
                                </div>
                                <div
                                  className="scope-seg"
                                  role="radiogroup"
                                  aria-label={t('scopeAria', { name: p.name })}
                                >
                                  {SCOPES.map((s) => (
                                    <button
                                      key={s ?? 'off'}
                                      role="radio"
                                      aria-checked={draft[p.code] === s}
                                      className={`scope-seg-btn${draft[p.code] === s ? ' active' : ''} ${s ? `scope-${s}` : 'scope-off'}`}
                                      onClick={() => setScope(p.code, s)}
                                      title={s ? t(scopeLabelKey(s)) : t('disableScope')}
                                    >
                                      {SCOPE_SHORT[s ?? '']}
                                    </button>
                                  ))}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>

                  <div className={`roles-savebar${dirty ? ' show' : ''}`}>
                    <span className="roles-savebar-text">
                      <Icon name="info" size={15} />
                      {t('savebar', { count: changedCount })}
                    </span>
                    <div className="roles-savebar-actions">
                      <button className="btn btn-ghost btn-ghost-dark" onClick={cancelEdit} disabled={saving}>
                        {t('actions.cancel', { ns: 'common' })}
                      </button>
                      <button className="btn btn-primary" onClick={savePermissions} disabled={saving}>
                        {saving && <span className="spinner" aria-hidden="true" />}
                        {saving ? t('saving') : t('savePerms')}
                      </button>
                    </div>
                  </div>

                  {!detail.is_system && (
                    <section className="danger-zone" aria-label={t('dangerZone.title')}>
                      <div className="danger-zone-info">
                        <h2>{t('dangerZone.title')}</h2>
                        <p>{t('dangerZone.desc')}</p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger-ghost"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Icon name="trash" size={15} /> {t('delete')}
                      </button>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {showCreate && (
        <Modal title={t('modal.createTitle')} onClose={() => setShowCreate(false)}>
          <RoleForm
            onClose={() => setShowCreate(false)}
            onSubmit={async (input) => {
              await rolesApi.create({ code: input.code!, name: input.name, description: input.description });
              toast(t('toast.created'), 'success');
              await loadRoles();
            }}
          />
        </Modal>
      )}

      {showEdit && detail && (
        <Modal title={t('modal.editTitle')} onClose={() => setShowEdit(false)}>
          <RoleForm
            initial={{ name: detail.name, description: detail.description || '' }}
            onClose={() => setShowEdit(false)}
            onSubmit={async (input) => {
              await doUpdateRole({ name: input.name, description: input.description || '' });
            }}
          />
        </Modal>
      )}

      {confirmDelete && detail && (
        <ConfirmDialog
          title={t('confirmDelete.title')}
          message={t('confirmDelete.message', { name: detail.name })}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
