import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import gu from '@/locales/gu.json';
import mr from '@/locales/mr.json';
import ta from '@/locales/ta.json';
import te from '@/locales/te.json';
import bn from '@/locales/bn.json';

export interface LanguageOption {
  code: string;
  label: string;
  /** Name written in the language itself, shown next to the English label in the picker. */
  nativeLabel: string;
}

// Order matches the client's requested list: English first, then the six
// Indian languages in the order given.
export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
  { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
];

export const DEFAULT_LANGUAGE = 'en';

/**
 * Device locale, mapped down to one of our 7 supported codes. Used only as
 * the very first guess before a stored preference is read — a phone set to
 * "hi-IN" should not force English on first launch.
 */
export function detectDeviceLanguage(): string {
  const tags = Localization.getLocales();
  for (const tag of tags) {
    const code = tag.languageCode;
    if (code && LANGUAGES.some((l) => l.code === code)) return code;
  }
  return DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    gu: { translation: gu },
    mr: { translation: mr },
    ta: { translation: ta },
    te: { translation: te },
    bn: { translation: bn },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  // React Native has no Suspense-friendly resource loader here — every
  // language is bundled at build time (see resources above), so synchronous
  // init/switch is correct and Suspense would only add an unneeded loading
  // state.
  react: { useSuspense: false },
});

export default i18n;
