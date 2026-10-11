/**
 * R4-1: route tĩnh đăng ký SAU route có tham số cùng method bị nuốt (DELETE /roles/assign rơi vào
 * DELETE /roles/:id -> 400). Duyệt toàn bộ router Express của app: mỗi route phải là route ĐẦU TIÊN
 * khớp với URL mẫu của chính nó (tham số thay bằng 123). Không cần DB.
 */
process.env.DATABASE_URL || (process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/test');

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app';

interface Layer {
  route?: { path: unknown; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  path?: string;
  match(path: string): boolean;
}

/** Tiền tố mount tĩnh từ regexp Express 4: ^\/api\/v1\/?(?=\/|$) -> /api/v1 */
const mountPrefix = (l: Layer) =>
  l.regexp.fast_slash
    ? ''
    : l.regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');

/** Mô phỏng dispatch của Express: route đầu tiên khớp method + path (bỏ qua middleware). */
function firstRoute(stack: Layer[], method: string, path: string): Layer | undefined {
  for (const l of stack) {
    if (!l.match(path)) continue;
    if (l.route) {
      if (l.route.methods[method] || l.route.methods._all) return l;
    } else if (l.handle.stack) {
      const hit = firstRoute(l.handle.stack, method, path.slice(l.path!.length) || '/');
      if (hit) return hit;
    }
  }
  return undefined;
}

function collect(stack: Layer[], prefix: string, out: Map<string, { layer: Layer; method: string }>) {
  for (const l of stack) {
    if (l.route && typeof l.route.path === 'string') {
      const url = prefix + l.route.path.replace(/:\w+(\([^)]*\))?\??/g, '123');
      for (const m of Object.keys(l.route.methods)) {
        // Cùng router mount 2 lần (/api/v1 và alias /api): chỉ xét lần đầu
        if (![...out.values()].some((x) => x.layer === l && x.method === m)) {
          out.set(`${m.toUpperCase()} ${url}`, { layer: l, method: m });
        }
      }
    } else if (l.handle.stack) {
      collect(l.handle.stack, prefix + mountPrefix(l), out);
    }
  }
}

describe('thứ tự route Express', () => {
  it('R4-1: không route nào bị route đăng ký trước (vd /:id) nuốt mất', () => {
    const stack = (createApp() as unknown as { _router: { stack: Layer[] } })._router.stack;
    const routes = new Map<string, { layer: Layer; method: string }>();
    collect(stack, '', routes);
    assert.ok(routes.has('DELETE /api/v1/roles/assign'), 'duyệt được router lồng nhau');
    assert.ok(routes.size > 100, `chỉ thấy ${routes.size} route`);
    const shadowed = [...routes].filter(([key, { layer, method }]) => {
      const hit = firstRoute(stack, method, key.slice(key.indexOf(' ') + 1));
      return hit !== layer;
    });
    assert.deepEqual(
      shadowed.map(([k]) => k),
      []
    );
  });
});
