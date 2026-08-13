import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { LANGUAGES, DEFAULT_LANGUAGE, detectDeviceLanguage, LanguageOption } from '@/lib/i18n';

interface LanguageContextValue {
  code: string;
  currentLanguage: LanguageOption;
  languages: LanguageOption[];
  setLanguage: (code: string) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = '@lifewise_language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState(DEFAULT_LANGUAGE);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      const resolved = stored && LANGUAGES.some((l) => l.code === stored) ? stored : detectDeviceLanguage();
      setCode(resolved);
      void i18n.changeLanguage(resolved);
    }).catch(() => {});
  }, []);

  const setLanguage = useCallback((newCode: string) => {
    if (!LANGUAGES.some((l) => l.code === newCode)) return;
    setCode(newCode);
    void i18n.changeLanguage(newCode);
    AsyncStorage.setItem(STORAGE_KEY, newCode).catch(() => {});
  }, []);

  const currentLanguage = useMemo(
    () => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0],
    [code],
  );

  const value = useMemo(() => ({
    code,
    currentLanguage,
    languages: LANGUAGES,
    setLanguage,
  }), [code, currentLanguage, setLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
