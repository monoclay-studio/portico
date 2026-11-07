import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { en } from './en';

export const LOCALES = [
  { code: 'en', label: 'English', dir: 'ltr' as const },
  { code: 'ar', label: 'العربية (stub)', dir: 'rtl' as const },
];
export type LocaleCode = (typeof LOCALES)[number]['code'];

const STORAGE_KEY = 'portico.locale';

function initialLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.some((l) => l.code === stored)) return stored as LocaleCode;
  } catch {
    // storage blocked
  }
  return 'en';
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function dirOf(code: string): 'ltr' | 'rtl' {
  return LOCALES.find((l) => l.code === code)?.dir ?? 'ltr';
}

export function applyDocumentLocale(code: string) {
  document.documentElement.lang = code;
  document.documentElement.dir = dirOf(code);
}

export async function setLocale(code: LocaleCode) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // ignore
  }
  await i18n.changeLanguage(code);
  applyDocumentLocale(code);
}
