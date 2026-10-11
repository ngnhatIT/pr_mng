import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

// PERF: chỉ 'common' nằm trong entry (Layout, toast, api() cần ngay). Namespace khác tách chunk riêng,
// tải lúc trang dùng tới (useTranslation suspend trong <Suspense> của PageOutlet / root).
import viCommon from './locales/vi/common.json';
import enCommon from './locales/en/common.json';

const loaders = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/*/common.json',
]);

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(lng, ns, cb) {
    // common đã nằm sẵn trong resources (không qua backend)
    const load = loaders[`./locales/${lng}/${ns}.json`];
    if (!load) return cb(new Error(`missing locale ${lng}/${ns}`), false);
    load().then(
      (m) => cb(null, m.default),
      (e: Error) => cb(e, false)
    );
  },
};

export const NAMESPACES = [
  'common',
  'dashboard',
  'students',
  'people',
  'tuition',
  'classes',
  'homework',
  'ops',
  'parent',
  'teacher',
  'auth',
  'landing',
  'roles',
] as const;

export type AppLang = 'vi' | 'en';

function detectLang(): AppLang {
  try {
    const stored = localStorage.getItem('educenter-lang');
    if (stored === 'vi' || stored === 'en') return stored;
    if (navigator.language.toLowerCase().startsWith('en')) return 'en';
  } catch {
    /* bỏ qua */
  }
  return 'vi';
}

void i18n
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: { vi: { common: viCommon }, en: { common: enCommon } },
    partialBundledLanguages: true,
    lng: detectLang(),
    // vi/en đồng bộ key (locales.test.ts) -> không cần fallback; tránh user en tải thêm cả file vi.
    fallbackLng: false,
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });

export function setAppLang(lng: AppLang) {
  try {
    localStorage.setItem('educenter-lang', lng);
  } catch {
    /* bỏ qua */
  }
  // Cập nhật <html lang> để screen reader phát âm đúng (WCAG 3.1.1)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
  void i18n.changeLanguage(lng);
}

// Đồng bộ <html lang> với ngôn ngữ khởi tạo
if (typeof document !== 'undefined') {
  document.documentElement.lang = detectLang();
}

export function getAppLang(): AppLang {
  return i18n.language === 'en' ? 'en' : 'vi';
}

export default i18n;
