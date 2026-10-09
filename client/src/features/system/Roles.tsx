/**
 * Trang quản trị Phân quyền (RBAC).
 *
 * Design read: công cụ cho admin trung tâm — calm, rõ ràng, mật độ trung bình-cao.
 * Cột trái: danh sách vai trò (tìm kiếm + chọn). Cột phải: ma trận quyền nhóm theo
 * module, mỗi quyền chọn phạm vi qua segmented control. System role chỉ xem.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../shared/ui/toast';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { Skeleton } from '../../shared/components/Skeleton';
import { Modal, ConfirmDialog } from '../../shared/components/Modal';
import { Icon } from '../../shared/components/icons';
import {
  rolesApi,
  moduleLabel,
  SCOPE_LABEL,
  type Role,
  type RoleDetail,
  type Permission,
  type Scope,
} from './roles.api';
import './Roles.css';

const SCOPES: (Scope | null)[] = [null, 'own', 'center', 'all'];
const SCOPE_SHORT: Record<string, string> = {
  '': 'Tắt',
  own: 'Của mình',
  center: 'Trung tâm',
  all: 'Tất cả',
};

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
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast('Vui lòng nhập tên vai trò', 'error');
      return;
    }
    let clean: string | undefined;
    if (!initial) {
      clean =
        code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') ||
        name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!clean) {
        toast('Vui lòng nhập mã vai trò', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      await onSubmit({ code: clean, name: name.trim(), description: description.trim() || undefined });
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-grid">
      {!initial && (
        <label className="form-field">
          <span>Mã vai trò</span>
          <input
            className="text-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="vd: le_tan (tự sinh từ tên nếu bỏ trống)"
          />
        </label>
      )}
      <label className="form-field">
        <span>Tên vai trò</span>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="vd: Lễ tân"
          autoFocus
        />
      </label>
      <label className="form-field">
        <span>Mô tả</span>
        <textarea
          className="text-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Vai trò này làm gì trong trung tâm?"
          rows={3}
        />
      </label>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Hủy
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Đang lưu...' : initial ? 'Lưu thay đổi' : 'Tạo vai trò'}
        </button>
      </div>
    </div>
  );
}

export function Roles() {
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

  const loadRoles = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([rolesApi.list(), rolesApi.permissions()]);
      setRoles(r.data);
      setCatalog(c.data);
      setSelectedId((prev) => {
        if (prev && r.data.some((x) => x.id === prev)) return prev;
        return r.data[0]?.id ?? null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('quyền')) setForbidden(true);
      else toast(msg || 'Không tải được danh sách vai trò', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const d = await rolesApi.detail(id);
      setDetail(d);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được chi tiết vai trò', 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

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
    return roles.filter(
      (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
    );
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
      toast(`Đã lưu ${permissions.length} quyền cho vai trò`, 'success');
      await loadDetail(detail.id);
      await loadRoles();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được quyền', 'error');
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
      toast('Đã xóa vai trò', 'success');
      setConfirmDelete(false);
      setSelectedId(null);
      setDetail(null);
      await loadRoles();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không xóa được vai trò', 'error');
    }
  };

  const doUpdateRole = async (input: { name: string; description: string }) => {
    if (!detail) return;
    await rolesApi.update(detail.id, input);
    toast('Đã cập nhật vai trò', 'success');
    await loadRoles();
    await loadDetail(detail.id);
  };

  if (loading) {
    return (
      <div className="page">
        <PageHeader title="Phân quyền" desc="Ai được làm gì, trên dữ liệu nào, trong phạm vi nào" />
        <Skeleton height={420} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="page">
        <PageHeader title="Phân quyền" desc="Ai được làm gì, trên dữ liệu nào, trong phạm vi nào" />
        <EmptyState
          icon="lock"
          title="Không có quyền truy cập"
          desc="Tài khoản của bạn không được xem trang phân quyền. Liên hệ quản trị viên nếu cần."
        />
      </div>
    );
  }

  return (
    <div className="page roles-page">
      <PageHeader
        title="Phân quyền"
        desc="Ai được làm gì, trên dữ liệu nào, trong phạm vi nào"
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={16} />
            Tạo vai trò
          </button>
        }
      />

      <div className="roles-layout">
        {/* Cột trái: danh sách vai trò */}
        <aside className="roles-list-col">
          <div className="roles-search">
            <Icon name="search" size={16} className="roles-search-icon" />
            <input
              className="text-input roles-search-input"
              placeholder="Tìm vai trò..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="roles-list">
            {filteredRoles.length === 0 ? (
              <EmptyState icon="users" title="Không tìm thấy" desc="Thử từ khóa khác." />
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
                      <span className="badge badge-system">Hệ thống</span>
                    ) : (
                      <span className="badge badge-custom">Tùy chỉnh</span>
                    )}
                  </div>
                  <div className="role-card-meta">
                    <span className="mono">@{r.code}</span>
                    <span aria-label={`${r.perm_count} quyền`}>
                      <Icon name="key" size={13} /> {r.perm_count}
                    </span>
                    <span aria-label={`${r.user_count} người dùng`}>
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
            <EmptyState
              icon="key"
              title="Chọn một vai trò"
              desc="Chọn vai trò ở danh sách bên trái để xem và chỉnh sửa quyền."
            />
          ) : (
            <>
              <div className="role-head">
                <div className="role-head-icon">
                  <Icon name={detail.is_system ? 'shield' : 'key'} size={22} />
                </div>
                <div className="role-head-info">
                  <h2>{detail.name}</h2>
                  <p>{detail.description || 'Chưa có mô tả.'}</p>
                  <div className="role-head-tags">
                    <span className="mono muted">@{detail.code}</span>
                    {detail.is_system && <span className="badge badge-system">Vai trò hệ thống: không sửa, không xóa</span>}
                  </div>
                </div>
                {!detail.is_system && (
                  <div className="role-head-actions">
                    <button className="btn btn-ghost" onClick={() => setShowEdit(true)}>
                      <Icon name="pencil" size={15} /> Sửa
                    </button>
                    <button className="btn btn-ghost btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                      <Icon name="trash" size={15} /> Xóa
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
                          <span className="perm-group-name">{moduleLabel(module)}</span>
                          <span className="muted">{assigned.length} quyền</span>
                        </div>
                        <ul className="perm-list">
                          {assigned.map((p) => (
                            <li key={p.code} className="perm-row readonly">
                              <div className="perm-info">
                                <div className="perm-name">{p.name}</div>
                                <div className="perm-code mono muted">{p.code}</div>
                              </div>
                              <span className={`scope-tag scope-${p.scope}`}>{SCOPE_LABEL[p.scope]}</span>
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
                            <span className="perm-group-name">{moduleLabel(module)}</span>
                            <span className="perm-group-tools">
                              <span className="muted">
                                {onCount}/{perms.length} đang bật
                              </span>
                              <button
                                className="link-btn"
                                onClick={() => toggleModule(module, !allOn)}
                              >
                                {allOn ? 'Tắt hết' : 'Bật hết'}
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
                                  aria-label={`Phạm vi quyền ${p.name}`}
                                >
                                  {SCOPES.map((s) => (
                                    <button
                                      key={s ?? 'off'}
                                      role="radio"
                                      aria-checked={draft[p.code] === s}
                                      className={`scope-seg-btn${draft[p.code] === s ? ' active' : ''} ${s ? `scope-${s}` : 'scope-off'}`}
                                      onClick={() => setScope(p.code, s)}
                                      title={s ? SCOPE_LABEL[s] : 'Tắt quyền này'}
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
                      {changedCount} thay đổi chưa lưu
                    </span>
                    <div className="roles-savebar-actions">
                      <button className="btn btn-ghost" onClick={cancelEdit} disabled={saving}>
                        Hủy
                      </button>
                      <button className="btn btn-primary" onClick={savePermissions} disabled={saving}>
                        {saving ? 'Đang lưu...' : 'Lưu quyền'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {showCreate && (
        <Modal title="Tạo vai trò mới" onClose={() => setShowCreate(false)}>
          <RoleForm
            onClose={() => setShowCreate(false)}
            onSubmit={async (input) => {
              await rolesApi.create({ code: input.code!, name: input.name, description: input.description });
              toast('Đã tạo vai trò mới', 'success');
              await loadRoles();
            }}
          />
        </Modal>
      )}

      {showEdit && detail && (
        <Modal title="Sửa vai trò" onClose={() => setShowEdit(false)}>
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
          title="Xóa vai trò?"
          message={`Vai trò "${detail.name}" sẽ bị xóa. Người dùng đang mang vai trò này sẽ mất các quyền đi kèm. Hành động này không thể hoàn tác.`}
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
