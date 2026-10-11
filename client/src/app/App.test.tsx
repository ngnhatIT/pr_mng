import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// Không có jsdom: render tĩnh (effect không chạy) + storage giả. Kiểm tra lần render ĐẦU sau reload.
function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

async function renderGuard(seed: Record<string, string>) {
  vi.resetModules();
  vi.stubGlobal('localStorage', memStorage(seed));
  vi.stubGlobal('sessionStorage', memStorage());
  vi.stubGlobal('window', { location: { pathname: '/app/students', search: '' } });
  const { RoleGuard } = await import('./App');
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/app/students']}>
      <RoleGuard roles={['admin']} loginPath="/login">
        <div id="page">PAGE</div>
      </RoleGuard>
    </MemoryRouter>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('RoleGuard boot (CORR-1)', () => {
  it('reload: còn user đã lưu nhưng chưa có token -> hiện loader chờ refresh, KHÔNG redirect login', async () => {
    const html = await renderGuard({ edu_user_staff: JSON.stringify({ id: 1, role: 'admin', name: 'A' }) });
    expect(html).toContain('route-loader');
    expect(html).not.toContain('PAGE');
  });

  it('chưa đăng nhập (không user) -> không hiện loader, không render trang', async () => {
    const html = await renderGuard({});
    expect(html).not.toContain('route-loader');
    expect(html).not.toContain('PAGE');
  });
});
