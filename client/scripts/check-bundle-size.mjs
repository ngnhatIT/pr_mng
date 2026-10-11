// B-8: ngân sách bundle (byte, chưa gzip). Chạy sau `vite build`: node client/scripts/check-bundle-size.mjs [distDir]
// Entry ~50 KB là thành quả code-split (trước đây 183 KB) -> chặn tụt lại. Tăng ngân sách thì sửa ở đây, có lý do.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET = { entry: 70_000, firstLoad: 400_000, totalJs: 1_000_000 };

const dist = process.argv[2] || new URL('../dist', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const size = (p) => statSync(join(dist, p)).size;

const entry = html.match(/<script[^>]+type="module"[^>]+src="\/(assets\/[^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Không tìm thấy entry script trong index.html');
const preloads = [...html.matchAll(/rel="modulepreload"[^>]+href="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const totalJs = readdirSync(join(dist, 'assets'))
  .filter((n) => n.endsWith('.js'))
  .reduce((s, n) => s + size(join('assets', n)), 0);

const actual = {
  entry: size(entry),
  firstLoad: [entry, ...preloads].reduce((s, p) => s + size(p), 0),
  totalJs,
};
let ok = true;
for (const k of Object.keys(BUDGET)) {
  const over = actual[k] > BUDGET[k];
  if (over) ok = false;
  console.log(
    `${over ? 'FAIL' : 'ok  '} ${k.padEnd(9)} ${(actual[k] / 1000).toFixed(1)} KB / ${BUDGET[k] / 1000} KB`
  );
}
if (!ok) process.exit(1);
