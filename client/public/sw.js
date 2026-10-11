/*
 * Service worker tối giản (CORR-3 / SEC-1 / SEC-4):
 * - Điều hướng (HTML): network-first, chỉ giữ 1 bản '/' làm shell dự phòng khi offline
 *   (không cache HTML theo từng URL -> sau deploy luôn lấy index.html mới).
 * - Chỉ cache /assets/* cùng origin có content-type JS/CSS (file có hash, bất biến).
 * - KHÔNG đụng tới /api, /uploads (file cần quyền) và mọi request có header Authorization.
 * - Tên cache theo phiên bản build (?v=<build id> lúc đăng ký từ main.tsx); activate xóa cache cũ.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'educenter-' + VERSION;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('Authorization')) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const type = res.headers.get('content-type') || '';
          if (res.ok && type.includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((res) => {
              const type = res.headers.get('content-type') || '';
              if (res.ok && /javascript|css/.test(type)) cache.put(request, res.clone());
              return res;
            })
        )
      )
    );
  }
});
