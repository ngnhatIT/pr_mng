import i18n, { NAMESPACES } from './i18n';

// Namespace ngoài 'common' tải lazy (i18n/index.ts). Test render tĩnh (renderToStaticMarkup không chờ Suspense)
// -> nạp sẵn mọi namespace trước mỗi file test.
await i18n.loadNamespaces([...NAMESPACES]);
