// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import { $, $$, byText, cleanup, click, json, mockFetch, renderPage, type Call } from '../../test-utils';
import { setAuth } from '../../shared/api/client';
import { Roles } from './Roles';

const t = (k: string, o?: Record<string, unknown>) => String(i18n.t(k, { ns: 'roles', ...o }));
const role = (id: number, name: string, is_system: boolean) => ({
  id,
  code: name.toLowerCase(),
  name,
  description: null,
  is_system,
  center_id: null,
  perm_count: 1,
  user_count: 2,
});
const catalog = [
  { id: 1, code: 'students.view', name: 'Xem HV', description: null, module: 'students' },
  { id: 2, code: 'invoices.view', name: 'Xem HĐ', description: null, module: 'invoices' },
  { id: 3, code: 'invoices.create', name: 'Tạo HĐ', description: null, module: 'invoices' },
];

function setup(extra: Record<string, unknown> = {}) {
  setAuth('roles', { id: 1, username: 'a', role: 'admin', name: 'A' });
  return mockFetch({
    'GET /roles': [role(1, 'Admin', true), role(2, 'KeToan', false)],
    'GET /roles/permissions': { catalog: 3, rows: catalog },
    'GET /roles/1': {
      ...role(1, 'Admin', true),
      permissions: [{ code: 'students.view', name: 'Xem HV', module: 'students', scope: 'all' }],
    },
    'GET /roles/2': {
      ...role(2, 'KeToan', false),
      permissions: [{ code: 'invoices.view', name: 'Xem HĐ', module: 'invoices', scope: 'center' }],
    },
    'PUT /roles/2/permissions': { ok: true, count: 2 },
    'DELETE /roles/2': { ok: true },
    ...extra,
  });
}
const scopeBtn = (name: string, idx: number) => $$(`[aria-label="${t('scopeAria', { name })}"] button`)[idx];
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

afterEach(cleanup);

describe('Roles', () => {
  it('vai trò hệ thống: chỉ xem (không ma trận sửa, không vùng xóa)', async () => {
    setup();
    await renderPage(<Roles />);
    expect($('.role-card.active')!.textContent).toContain('Admin');
    expect($('.perm-row.readonly')!.textContent).toContain('students.view');
    expect($('.scope-seg')).toBeNull();
    expect($('.danger-zone')).toBeNull();
  });

  it('không có quyền xem -> trang "không có quyền" thay vì toast lỗi', async () => {
    mockFetch({
      'GET /roles': json(403, { error: 'x', code: 'FORBIDDEN' }),
      'GET /roles/permissions': { catalog: 0, rows: [] },
    });
    await renderPage(<Roles />);
    expect(document.body.textContent).toContain(t('forbidden.title'));
    expect($('.toast')).toBeNull();
  });

  it('vai trò tùy chỉnh: sửa phạm vi + bật cả module -> PUT đúng danh sách; đổi vai trò khi chưa lưu phải xác nhận', async () => {
    const calls = setup();
    await renderPage(<Roles />);
    await click(byText('KeToan'));
    expect(scopeBtn('Xem HĐ', 2).getAttribute('aria-checked')).toBe('true'); // center
    await click(scopeBtn('Xem HV', 1)); // own
    await click($$('.link-btn').find((b) => b.textContent === t('turnOnAll'))!); // invoices: bật hết = center
    expect($('.roles-savebar.show')!.textContent).toContain(t('savebar', { count: 2 }));

    await click(byText('Admin'));
    expect($('[role="dialog"]')!.textContent).toContain(t('discard.title'));
    await click($('[role="dialog"] .modal-actions .btn')); // Hủy -> giữ nguyên
    expect($('.role-card.active')!.textContent).toContain('KeToan');

    await click(byText(t('savePerms')));
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: 'PUT', path: '/roles/2/permissions' });
    expect((writes(calls)[0].body as { permissions: unknown[] }).permissions).toEqual(
      expect.arrayContaining([
        { code: 'students.view', scope: 'own' },
        { code: 'invoices.view', scope: 'center' },
        { code: 'invoices.create', scope: 'center' },
      ])
    );
  });

  it('xóa vai trò tùy chỉnh -> DELETE rồi tải lại danh sách', async () => {
    const calls = setup();
    await renderPage(<Roles />);
    await click(byText('KeToan'));
    await click($('.danger-zone button'));
    await click($$('[role="dialog"] .modal-actions .btn').at(-1)!);
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'DELETE', path: '/roles/2' })]);
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/roles')).toHaveLength(2);
  });
});
