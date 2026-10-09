import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import viCommon from './locales/vi/common.json';
import enCommon from './locales/en/common.json';
import viDashboard from './locales/vi/dashboard.json';
import enDashboard from './locales/en/dashboard.json';
import viStudents from './locales/vi/students.json';
import enStudents from './locales/en/students.json';
import viPeople from './locales/vi/people.json';
import enPeople from './locales/en/people.json';
import viTuition from './locales/vi/tuition.json';
import enTuition from './locales/en/tuition.json';
import viClasses from './locales/vi/classes.json';
import enClasses from './locales/en/classes.json';
import viHomework from './locales/vi/homework.json';
import enHomework from './locales/en/homework.json';
import viOps from './locales/vi/ops.json';
import enOps from './locales/en/ops.json';
import viParent from './locales/vi/parent.json';
import enParent from './locales/en/parent.json';
import viTeacher from './locales/vi/teacher.json';
import enTeacher from './locales/en/teacher.json';
import viAuth from './locales/vi/auth.json';
import enAuth from './locales/en/auth.json';
import viLanding from './locales/vi/landing.json';
import enLanding from './locales/en/landing.json';

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

void i18n.use(initReactI18next).init({
  resources: {
    vi: {
      common: viCommon,
      dashboard: viDashboard,
      students: viStudents,
      people: viPeople,
      tuition: viTuition,
      classes: viClasses,
      homework: viHomework,
      ops: viOps,
      parent: viParent,
      teacher: viTeacher,
      auth: viAuth,
      landing: viLanding,
    },
    en: {
      common: enCommon,
      dashboard: enDashboard,
      students: enStudents,
      people: enPeople,
      tuition: enTuition,
      classes: enClasses,
      homework: enHomework,
      ops: enOps,
      parent: enParent,
      teacher: enTeacher,
      auth: enAuth,
      landing: enLanding,
    },
  },
  lng: detectLang(),
  fallbackLng: 'vi',
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export function setAppLang(lng: AppLang) {
  try {
    localStorage.setItem('educenter-lang', lng);
  } catch {
    /* bỏ qua */
  }
  void i18n.changeLanguage(lng);
}

export function getAppLang(): AppLang {
  return i18n.language === 'en' ? 'en' : 'vi';
}

export default i18n;
