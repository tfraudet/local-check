import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

const SUPPORTED = ['en', 'fr'] as const;
type Supported = (typeof SUPPORTED)[number];

function detectInitialLng(): Supported {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem('local-check.language');
  if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
    return stored as Supported;
  }
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split('-')[0];
    if ((SUPPORTED as readonly string[]).includes(base)) {
      return base as Supported;
    }
  }
  return 'en';
}

const initialLng = detectInitialLng();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
